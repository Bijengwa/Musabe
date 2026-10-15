"""Issuing service: lending and returning book copies and stock items.

Only a Librarian issues items, and only for a branch they belong to. Issuing a
book copy requires it to be ``AVAILABLE`` and flips it to ``ISSUED``; issuing a
stock item writes an ``OUT`` stock movement and can never take stock below
zero. Returning stamps ``returned_at`` and makes a book copy ``AVAILABLE``
again. Every action writes an ``audit_logs`` row.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.models.inventory import StockItem
from app.models.issuing import Issue, IssueStatus
from app.models.library import BookCopy, BookCopyStatus
from app.models.user import User
from app.schemas.issuing import IssueCreate
from app.services import audit_service, inventory_service, request_service


def _resolve_own_branch(
    db: Session, user: User, branch_id: int | None
) -> Branch:
    """Resolve the branch an action applies to, restricted to the user's own.

    Raises:
        HTTPException: 400 when the branch cannot be inferred, 403 when a
            school-role user targets a foreign branch, or 404 when the branch
            does not exist.
    """
    allowed = request_service.user_branch_ids(user)
    if branch_id is None:
        if len(allowed) != 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="branch_id is required when you belong to multiple branches",
            )
        branch_id = next(iter(allowed))
    elif not request_service.is_central(user) and branch_id not in allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only issue items for your own branch",
        )
    branch = db.get(Branch, branch_id)
    if branch is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Branch not found",
        )
    return branch


def _scope_clauses(user: User, column, branch_id: int | None) -> list:
    """Return filters enforcing branch visibility for ``column``."""
    clauses = []
    if branch_id is not None:
        clauses.append(column == branch_id)
    if not request_service.is_central(user):
        clauses.append(column.in_(request_service.user_branch_ids(user)))
    return clauses


def get_issue(db: Session, user: User, issue_id: int) -> Issue:
    """Return a single visible issue or raise 404.

    Raises:
        HTTPException: 404 if the issue does not exist or is out of scope.
    """
    issue = db.get(Issue, issue_id)
    if issue is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Issue not found",
        )
    if not request_service.is_central(user):
        if issue.branch_id not in request_service.user_branch_ids(user):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Issue not found",
            )
    return issue


def create_issue(db: Session, user: User, data: IssueCreate) -> Issue:
    """Issue a book copy or a stock item and record it.

    Raises:
        HTTPException: 400 for an invalid payload, 404 when the copy/item or
            branch is not found, 409 when the book copy is not available, or
            400 when the stock issue would take quantity below zero.
    """
    branch = _resolve_own_branch(db, user, data.branch_id)

    has_book = data.book_code is not None
    has_stock = data.item_name is not None
    if has_book == has_stock:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Provide exactly one of book_code or item_name",
        )

    if has_book:
        copy = db.scalar(
            select(BookCopy).where(BookCopy.code == data.book_code)
        )
        if copy is None or copy.branch_id != branch.id:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Book copy not found",
            )
        if copy.status is not BookCopyStatus.AVAILABLE:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Book copy is not available",
            )
        copy.status = BookCopyStatus.ISSUED
        issue = Issue(
            branch_id=branch.id,
            issued_by_id=user.id,
            borrower=data.borrower,
            book_copy_id=copy.id,
            status=IssueStatus.ISSUED,
        )
    else:
        quantity = data.quantity
        if quantity is None:
            quantity = 1 if data.size else None
        if not quantity or quantity <= 0:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Provide a quantity or a size for a stock issue",
            )
        item = db.scalar(
            select(StockItem).where(
                StockItem.branch_id == branch.id,
                StockItem.item_name == data.item_name,
            )
        )
        if item is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Stock item not found",
            )
        inventory_service.remove_stock(
            db,
            user=user,
            branch_id=branch.id,
            item_name=item.item_name,
            quantity=quantity,
            note=f"Issued to {data.borrower}",
        )
        issue = Issue(
            branch_id=branch.id,
            issued_by_id=user.id,
            borrower=data.borrower,
            stock_item_id=item.id,
            quantity=quantity,
            size=data.size,
            status=IssueStatus.ISSUED,
        )

    db.add(issue)
    db.flush()
    audit_service.log_action(
        db,
        action="ISSUE",
        actor_id=user.id,
        detail=f"issue:{issue.id}",
    )
    db.commit()
    db.refresh(issue)
    return issue


def return_issue(db: Session, user: User, issue_id: int) -> Issue:
    """Return an issue, restocking the item where applicable.

    A returned book copy becomes ``AVAILABLE``; a returned stock issue adds the
    quantity back to stock with an ``IN`` movement.

    Raises:
        HTTPException: 404 if the issue is not visible, or 409 if it has
            already been returned.
    """
    issue = get_issue(db, user, issue_id)
    if issue.status is IssueStatus.RETURNED:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Issue has already been returned",
        )

    issue.returned_at = datetime.now(timezone.utc)
    issue.status = IssueStatus.RETURNED

    if issue.book_copy_id is not None:
        copy = db.get(BookCopy, issue.book_copy_id)
        if copy is not None:
            copy.status = BookCopyStatus.AVAILABLE
    elif issue.stock_item_id is not None and issue.quantity:
        item = db.get(StockItem, issue.stock_item_id)
        if item is not None:
            inventory_service.add_stock(
                db,
                user=user,
                branch_id=issue.branch_id,
                item_name=item.item_name,
                quantity=issue.quantity,
                note=f"Returned by {issue.borrower}",
            )

    audit_service.log_action(
        db,
        action="RETURN",
        actor_id=user.id,
        detail=f"issue:{issue.id}",
    )
    db.commit()
    db.refresh(issue)
    return issue


def list_issues(
    db: Session,
    user: User,
    *,
    borrower: str | None = None,
    issue_status: IssueStatus | None = None,
    branch_id: int | None = None,
) -> Sequence[Issue]:
    """Return issues visible to ``user``, with optional filters."""
    stmt = select(Issue).order_by(Issue.id)
    for clause in _scope_clauses(user, Issue.branch_id, branch_id):
        stmt = stmt.where(clause)
    if borrower:
        stmt = stmt.where(Issue.borrower.ilike(f"%{borrower}%"))
    if issue_status is not None:
        stmt = stmt.where(Issue.status == issue_status)
    return db.scalars(stmt).all()
