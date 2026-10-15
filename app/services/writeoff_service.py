"""Write-off service: recording lost/damaged copies and reviewing them.

A Librarian records a lost or damaged book copy as a PENDING write-off. The
Head Master of the same branch approves or rejects it. Approval sets the copy's
status to ``WRITTEN_OFF``; rejection leaves the copy unchanged. Every action
writes an ``audit_logs`` row.
"""

from __future__ import annotations

from collections.abc import Sequence
from datetime import datetime, timezone

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.branch import Branch
from app.models.library import BookCopy, BookCopyStatus
from app.models.user import User
from app.models.writeoff import WriteOff, WriteOffStatus
from app.schemas.writeoff import WriteOffCreate
from app.services import audit_service, request_service


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
            detail="You can only record write-offs for your own branch",
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


def create_writeoff(db: Session, user: User, data: WriteOffCreate) -> WriteOff:
    """Record a PENDING write-off for a lost or damaged book copy.

    Raises:
        HTTPException: 400 when the copy is already written off, 404 when the
            copy or branch is not found.
    """
    branch = _resolve_own_branch(db, user, data.branch_id)
    copy = db.scalar(select(BookCopy).where(BookCopy.code == data.book_code))
    if copy is None or copy.branch_id != branch.id:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Book copy not found",
        )
    if copy.status is BookCopyStatus.WRITTEN_OFF:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Book copy is already written off",
        )

    writeoff = WriteOff(
        branch_id=branch.id,
        book_copy_id=copy.id,
        reported_by_id=user.id,
        reason=data.reason,
        report=data.report,
        status=WriteOffStatus.PENDING,
    )
    db.add(writeoff)
    db.flush()
    audit_service.log_action(
        db,
        action="WRITE_OFF",
        actor_id=user.id,
        detail=f"write_off:{writeoff.id}",
    )
    db.commit()
    db.refresh(writeoff)
    return writeoff


def get_writeoff(db: Session, user: User, writeoff_id: int) -> WriteOff:
    """Return a single visible write-off or raise 404.

    Raises:
        HTTPException: 404 if the write-off does not exist or is out of scope.
    """
    writeoff = db.get(WriteOff, writeoff_id)
    if writeoff is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Write-off not found",
        )
    if not request_service.is_central(user):
        if writeoff.branch_id not in request_service.user_branch_ids(user):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Write-off not found",
            )
    return writeoff


def decide_writeoff(
    db: Session,
    user: User,
    writeoff_id: int,
    *,
    approve: bool,
    note: str | None = None,
) -> WriteOff:
    """Approve or reject a PENDING write-off.

    Approval sets the book copy to ``WRITTEN_OFF``; rejection leaves it
    unchanged.

    Raises:
        HTTPException: 404 if the write-off is not visible, or 409 if it has
            already been decided.
    """
    writeoff = get_writeoff(db, user, writeoff_id)
    if writeoff.status is not WriteOffStatus.PENDING:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Write-off has already been decided",
        )

    writeoff.status = (
        WriteOffStatus.APPROVED if approve else WriteOffStatus.REJECTED
    )
    writeoff.reviewed_by_id = user.id
    writeoff.reviewed_at = datetime.now(timezone.utc)
    writeoff.decision_note = note

    if approve:
        copy = db.get(BookCopy, writeoff.book_copy_id)
        if copy is not None:
            copy.status = BookCopyStatus.WRITTEN_OFF

    audit_service.log_action(
        db,
        action="WRITE_OFF_APPROVE" if approve else "WRITE_OFF_REJECT",
        actor_id=user.id,
        detail=f"write_off:{writeoff.id}",
    )
    db.commit()
    db.refresh(writeoff)
    return writeoff


def list_writeoffs(
    db: Session,
    user: User,
    *,
    writeoff_status: WriteOffStatus | None = None,
    branch_id: int | None = None,
) -> Sequence[WriteOff]:
    """Return write-offs visible to ``user``, with optional filters."""
    stmt = select(WriteOff).order_by(WriteOff.id)
    for clause in _scope_clauses(user, WriteOff.branch_id, branch_id):
        stmt = stmt.where(clause)
    if writeoff_status is not None:
        stmt = stmt.where(WriteOff.status == writeoff_status)
    return db.scalars(stmt).all()
