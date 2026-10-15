"""Library catalogue and inventory stock service.

Two related concerns live here because the project groups library and
inventory under a single service:

* **Library** — cataloguing an approved BOOK request into
  :class:`~app.models.library.BookTitle`/:class:`~app.models.library.BookCopy`
  rows, and querying the catalogue. Cataloguing moves the request to
  ``CATALOGUED`` through :func:`app.services.workflow.apply_transition` and
  writes an audit row.
* **Inventory** — :func:`add_stock`, :func:`remove_stock`, and
  :func:`adjust_stock`, each of which always writes a ``StockMovement`` row
  recording the acting user and a reference id. Stock quantity can never go
  below zero.

Branch scoping: school-role users only see their own branch's books and stock;
central-role users see everything.
"""

from __future__ import annotations

from collections.abc import Sequence

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from app.models.branch import Branch, BranchType
from app.models.contribution import ParentContribution
from app.models.inventory import StockItem, StockMovement, StockMovementType
from app.models.library import BookCopy, BookCopyStatus, BookTitle
from app.models.request import Request, RequestType
from app.models.user import Role, User
from app.schemas.contribution import ContributionCreate
from app.schemas.library import BookCopyRead
from app.services import audit_service, request_service, workflow
from app.services.workflow import WorkflowAction
from app.utils.codes import generate_copy_code


def _roles(user: User) -> set[Role]:
    """Return the set of roles held by ``user``."""
    return {assignment.role for assignment in user.assignments}


def _branch_clauses(user: User, column, branch_id: int | None) -> list:
    """Return SQLAlchemy filters enforcing branch visibility for ``column``.

    Central users are unrestricted except by an explicit ``branch_id`` filter;
    school users are always limited to their own branches.
    """
    clauses = []
    if branch_id is not None:
        clauses.append(column == branch_id)
    if not request_service.is_central(user):
        clauses.append(column.in_(request_service.user_branch_ids(user)))
    return clauses


# --------------------------------------------------------------------------- #
# Library: cataloguing
# --------------------------------------------------------------------------- #
def catalogue_request(db: Session, user: User, request_id: int) -> Request:
    """Catalogue a BOOK request that has been sent to the school.

    Creates a :class:`BookTitle` for each request line (if one with the same
    title does not already exist) and one AVAILABLE :class:`BookCopy` per
    requested quantity, each with a unique code. The request is then moved to
    ``CATALOGUED`` via the workflow engine and an audit row is written.

    Raises:
        HTTPException: 400 if the request is not a BOOK request, 404 if it is
            not visible, or 409/403 from the workflow engine.
    """
    request = request_service.get_request(db, user, request_id)
    if request.type is not RequestType.BOOK:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only BOOK requests can be catalogued",
        )

    # Validate the transition before creating any rows.
    new_status = workflow.apply_transition(
        request_type=request.type,
        current_status=request.status,
        action=WorkflowAction.CATALOGUE,
        roles=_roles(user),
    )

    branch = db.get(Branch, request.branch_id)
    branch_name = branch.name if branch is not None else "GEN"

    title_cache: dict[str, BookTitle] = {}
    used_codes: set[str] = set()
    copy_count = 0
    for line in request.lines:
        book_title = title_cache.get(line.description)
        if book_title is None:
            book_title = db.scalar(
                select(BookTitle).where(BookTitle.title == line.description)
            )
            if book_title is None:
                book_title = BookTitle(title=line.description)
                db.add(book_title)
                db.flush()
            title_cache[line.description] = book_title

        for _ in range(line.quantity):
            code = generate_copy_code(db, branch_name, used=used_codes)
            db.add(
                BookCopy(
                    code=code,
                    title_id=book_title.id,
                    branch_id=request.branch_id,
                    status=BookCopyStatus.AVAILABLE,
                    request_id=request.id,
                )
            )
            copy_count += 1

    from_status = request.status
    request.status = new_status
    audit_service.log_action(
        db,
        action=WorkflowAction.CATALOGUE.value,
        request_id=request.id,
        actor_id=user.id,
        from_status=from_status.value,
        to_status=new_status.value,
        detail=f"{copy_count} copies catalogued",
    )
    db.commit()
    db.refresh(request)
    return request


def _to_read(copy: BookCopy) -> BookCopyRead:
    """Flatten a :class:`BookCopy` and its title into an API schema."""
    return BookCopyRead(
        id=copy.id,
        code=copy.code,
        title_id=copy.title_id,
        title=copy.title.title,
        author=copy.title.author,
        isbn=copy.title.isbn,
        branch_id=copy.branch_id,
        status=copy.status,
        request_id=copy.request_id,
        created_at=copy.created_at,
    )


def list_books(
    db: Session,
    user: User,
    *,
    title: str | None = None,
    book_status: BookCopyStatus | None = None,
    branch_id: int | None = None,
) -> list[BookCopyRead]:
    """Return catalogue copies visible to ``user``, with optional filters."""
    stmt = (
        select(BookCopy)
        .join(BookTitle)
        .options(joinedload(BookCopy.title))
        .order_by(BookCopy.code)
    )
    for clause in _branch_clauses(user, BookCopy.branch_id, branch_id):
        stmt = stmt.where(clause)
    if title:
        stmt = stmt.where(BookTitle.title.ilike(f"%{title}%"))
    if book_status is not None:
        stmt = stmt.where(BookCopy.status == book_status)
    return [_to_read(copy) for copy in db.scalars(stmt).all()]


def get_book(db: Session, user: User, code: str) -> BookCopyRead:
    """Return a single catalogue copy by code.

    Raises:
        HTTPException: 404 if the copy does not exist or is out of scope.
    """
    copy = db.scalar(
        select(BookCopy)
        .options(joinedload(BookCopy.title))
        .where(BookCopy.code == code)
    )
    if copy is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Book copy not found",
        )
    if not request_service.is_central(user):
        if copy.branch_id not in request_service.user_branch_ids(user):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Book copy not found",
            )
    return _to_read(copy)


# --------------------------------------------------------------------------- #
# Inventory: stock levels
# --------------------------------------------------------------------------- #
def list_stock(
    db: Session, user: User, *, branch_id: int | None = None
) -> Sequence[StockItem]:
    """Return stock levels visible to ``user``, optionally filtered by branch."""
    stmt = select(StockItem).order_by(StockItem.item_name)
    for clause in _branch_clauses(user, StockItem.branch_id, branch_id):
        stmt = stmt.where(clause)
    return db.scalars(stmt).all()


def _get_or_create_item(
    db: Session, branch_id: int, item_name: str
) -> StockItem:
    """Return the stock item for ``branch_id``/``item_name`` or create it."""
    item = db.scalar(
        select(StockItem).where(
            StockItem.branch_id == branch_id,
            StockItem.item_name == item_name,
        )
    )
    if item is None:
        item = StockItem(branch_id=branch_id, item_name=item_name, quantity=0)
        db.add(item)
        db.flush()
    return item


def _record_movement(
    db: Session,
    item: StockItem,
    *,
    user: User,
    movement_type: StockMovementType,
    quantity: int,
    reference_id: int | None,
    note: str | None,
) -> StockMovement:
    """Append a stock movement row for ``item`` and flush it."""
    movement = StockMovement(
        stock_item_id=item.id,
        movement_type=movement_type,
        quantity=quantity,
        actor_id=user.id,
        reference_id=reference_id,
        note=note,
    )
    db.add(movement)
    db.flush()
    return movement


def add_stock(
    db: Session,
    *,
    user: User,
    branch_id: int,
    item_name: str,
    quantity: int,
    reference_id: int | None = None,
    movement_type: StockMovementType = StockMovementType.IN,
    note: str | None = None,
) -> StockItem:
    """Increase stock by ``quantity`` and record a movement.

    Raises:
        HTTPException: 400 if ``quantity`` is not positive.
    """
    if quantity <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Quantity must be positive",
        )
    item = _get_or_create_item(db, branch_id, item_name)
    item.quantity += quantity
    _record_movement(
        db,
        item,
        user=user,
        movement_type=movement_type,
        quantity=quantity,
        reference_id=reference_id,
        note=note,
    )
    db.flush()
    return item


def remove_stock(
    db: Session,
    *,
    user: User,
    branch_id: int,
    item_name: str,
    quantity: int,
    reference_id: int | None = None,
    note: str | None = None,
) -> StockItem:
    """Decrease stock by ``quantity`` and record an OUT movement.

    Raises:
        HTTPException: 400 if ``quantity`` is not positive or the resulting
            quantity would drop below zero.
    """
    if quantity <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Quantity must be positive",
        )
    item = _get_or_create_item(db, branch_id, item_name)
    if item.quantity - quantity < 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Stock quantity cannot go below zero",
        )
    item.quantity -= quantity
    _record_movement(
        db,
        item,
        user=user,
        movement_type=StockMovementType.OUT,
        quantity=quantity,
        reference_id=reference_id,
        note=note,
    )
    db.flush()
    return item


def adjust_stock(
    db: Session,
    *,
    user: User,
    branch_id: int,
    item_name: str,
    new_quantity: int,
    reference_id: int | None = None,
    note: str | None = None,
) -> StockItem:
    """Set stock to ``new_quantity`` and record an ADJUST movement.

    Raises:
        HTTPException: 400 if ``new_quantity`` is negative.
    """
    if new_quantity < 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Stock quantity cannot go below zero",
        )
    item = _get_or_create_item(db, branch_id, item_name)
    delta = new_quantity - item.quantity
    item.quantity = new_quantity
    _record_movement(
        db,
        item,
        user=user,
        movement_type=StockMovementType.ADJUST,
        quantity=abs(delta),
        reference_id=reference_id,
        note=note,
    )
    db.flush()
    return item


# --------------------------------------------------------------------------- #
# Parent contributions (PRIMARY branches only)
# --------------------------------------------------------------------------- #
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
            detail="You can only record contributions for your own branch",
        )
    branch = db.get(Branch, branch_id)
    if branch is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Branch not found",
        )
    return branch


def record_contribution(
    db: Session, user: User, data: ContributionCreate
) -> ParentContribution:
    """Record a parent contribution and increase the branch's stock.

    Contributions are only allowed for PRIMARY branches; a PARENT stock
    movement is written and an audit row recorded.

    Raises:
        HTTPException: 400 when the branch is not PRIMARY, 403/404 when the
            branch is not the user's own or does not exist.
    """
    branch = _resolve_own_branch(db, user, data.branch_id)
    if branch.type is not BranchType.PRIMARY:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Parent contributions are only allowed for PRIMARY branches",
        )

    contribution = ParentContribution(
        branch_id=branch.id,
        recorded_by_id=user.id,
        contributor=data.contributor,
        item_name=data.item_name,
        quantity=data.quantity,
        note=data.note,
    )
    db.add(contribution)
    db.flush()

    add_stock(
        db,
        user=user,
        branch_id=branch.id,
        item_name=data.item_name,
        quantity=data.quantity,
        reference_id=contribution.id,
        movement_type=StockMovementType.PARENT,
        note=data.note,
    )

    audit_service.log_action(
        db,
        action="CONTRIBUTION",
        actor_id=user.id,
        detail=f"contribution:{contribution.id}",
    )
    db.commit()
    db.refresh(contribution)
    return contribution


def list_contributions(
    db: Session, user: User, *, branch_id: int | None = None
) -> Sequence[ParentContribution]:
    """Return parent contributions visible to ``user``."""
    stmt = select(ParentContribution).order_by(ParentContribution.id)
    for clause in _branch_clauses(user, ParentContribution.branch_id, branch_id):
        stmt = stmt.where(clause)
    return db.scalars(stmt).all()
