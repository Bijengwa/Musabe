"""Management reports service.

Read-only aggregations used by the reports dashboard. Reports respect branch
visibility exactly like the rest of the app: school-role users only see their
own branch, central-role users see everything (optionally filtered by an
explicit ``branch_id``).

Nothing in this module mutates state, so no audit rows are written here.
"""

from __future__ import annotations

from collections.abc import Sequence
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.audit import AuditLog
from app.models.branch import Branch
from app.models.contribution import ParentContribution
from app.models.inventory import StockItem
from app.models.issuing import Issue, IssueStatus
from app.models.library import BookCopy
from app.models.procurement import Payment, PurchaseOrder
from app.models.request import Request, RequestStatus
from app.models.user import User
from app.models.writeoff import WriteOff, WriteOffStatus
from app.schemas.reports import (
    ActivityRow,
    OutstandingIssueRow,
    PendingRequestRow,
    ReportsOverview,
    SpendReportRow,
    StatusCount,
    StockReportRow,
)
from app.services import request_service

#: Stock at or below this quantity is flagged as low in the stock report.
LOW_STOCK_THRESHOLD = 5

#: Request statuses that end a request's lifecycle.
TERMINAL_STATUSES = frozenset(
    {RequestStatus.CATALOGUED, RequestStatus.IN_STORE, RequestStatus.REJECTED}
)


def _branch_clauses(user: User, column, branch_id: int | None) -> list:
    """Return SQLAlchemy filters enforcing branch visibility for ``column``."""
    clauses = []
    if branch_id is not None:
        clauses.append(column == branch_id)
    if not request_service.is_central(user):
        clauses.append(column.in_(request_service.user_branch_ids(user)))
    return clauses


def _to_decimal(value: object) -> Decimal:
    """Coerce a numeric aggregate result (possibly ``None``) to :class:`Decimal`."""
    return Decimal(str(value)) if value is not None else Decimal("0")


def _status_counts(rows: Sequence[tuple[object, int]]) -> list[StatusCount]:
    """Convert ``(status, count)`` rows into :class:`StatusCount` models."""
    return [
        StatusCount(status=getattr(status, "value", str(status)), count=count)
        for status, count in rows
    ]


def overview(
    db: Session, user: User, *, branch_id: int | None = None
) -> ReportsOverview:
    """Return a dashboard summary scoped to the user's visible branches."""
    req_scope = _branch_clauses(user, Request.branch_id, branch_id)

    requests_rows = db.execute(
        select(Request.status, func.count())
        .where(*req_scope)
        .group_by(Request.status)
    ).all()
    requests_by_status = _status_counts(requests_rows)
    total_requests = sum(item.count for item in requests_by_status)
    pending_requests = sum(
        item.count
        for item in requests_by_status
        if item.status not in {s.value for s in TERMINAL_STATUSES}
    )

    copy_rows = db.execute(
        select(BookCopy.status, func.count())
        .where(*_branch_clauses(user, BookCopy.branch_id, branch_id))
        .group_by(BookCopy.status)
    ).all()
    book_copies_by_status = _status_counts(copy_rows)
    total_book_copies = sum(item.count for item in book_copies_by_status)

    stock_scope = _branch_clauses(user, StockItem.branch_id, branch_id)
    stock_items = db.scalar(
        select(func.count()).select_from(StockItem).where(*stock_scope)
    )
    low_stock_items = db.scalar(
        select(func.count())
        .select_from(StockItem)
        .where(*stock_scope, StockItem.quantity <= LOW_STOCK_THRESHOLD)
    )

    outstanding_issues = db.scalar(
        select(func.count())
        .select_from(Issue)
        .where(
            *_branch_clauses(user, Issue.branch_id, branch_id),
            Issue.status == IssueStatus.ISSUED,
        )
    )
    pending_writeoffs = db.scalar(
        select(func.count())
        .select_from(WriteOff)
        .where(
            *_branch_clauses(user, WriteOff.branch_id, branch_id),
            WriteOff.status == WriteOffStatus.PENDING,
        )
    )
    total_contributions = db.scalar(
        select(func.count())
        .select_from(ParentContribution)
        .where(*_branch_clauses(user, ParentContribution.branch_id, branch_id))
    )

    total_ordered = db.scalar(
        select(func.coalesce(func.sum(PurchaseOrder.total_amount), 0)).join(
            Request, PurchaseOrder.request_id == Request.id
        ).where(*req_scope)
    )
    total_paid = db.scalar(
        select(func.coalesce(func.sum(Payment.amount), 0))
        .join(Request, Payment.request_id == Request.id)
        .where(*req_scope)
    )

    return ReportsOverview(
        total_requests=total_requests,
        pending_requests=pending_requests,
        requests_by_status=requests_by_status,
        total_book_copies=total_book_copies,
        book_copies_by_status=book_copies_by_status,
        stock_items=stock_items or 0,
        low_stock_items=low_stock_items or 0,
        outstanding_issues=outstanding_issues or 0,
        pending_writeoffs=pending_writeoffs or 0,
        total_contributions=total_contributions or 0,
        total_ordered=_to_decimal(total_ordered),
        total_paid=_to_decimal(total_paid),
    )


def pending_requests(
    db: Session, user: User, *, branch_id: int | None = None
) -> list[PendingRequestRow]:
    """Return requests that are not yet in a terminal status."""
    stmt = (
        select(Request)
        .where(
            *_branch_clauses(user, Request.branch_id, branch_id),
            Request.status.notin_(list(TERMINAL_STATUSES)),
        )
        .order_by(Request.created_at, Request.id)
    )
    requests = db.scalars(stmt).all()
    return [PendingRequestRow.model_validate(r) for r in requests]


def stock_report(
    db: Session, user: User, *, branch_id: int | None = None
) -> list[StockReportRow]:
    """Return current stock levels with a low-stock flag."""
    stmt = (
        select(StockItem)
        .where(*_branch_clauses(user, StockItem.branch_id, branch_id))
        .order_by(StockItem.branch_id, StockItem.item_name)
    )
    items = db.scalars(stmt).all()
    return [
        StockReportRow(
            id=item.id,
            branch_id=item.branch_id,
            item_name=item.item_name,
            quantity=item.quantity,
            is_low=item.quantity <= LOW_STOCK_THRESHOLD,
        )
        for item in items
    ]


def outstanding_issues(
    db: Session, user: User, *, branch_id: int | None = None
) -> list[OutstandingIssueRow]:
    """Return issues that have not yet been returned."""
    stmt = (
        select(Issue)
        .where(
            *_branch_clauses(user, Issue.branch_id, branch_id),
            Issue.status == IssueStatus.ISSUED,
        )
        .order_by(Issue.created_at, Issue.id)
    )
    issues = db.scalars(stmt).all()
    return [OutstandingIssueRow.model_validate(i) for i in issues]


def spend_report(
    db: Session, user: User, *, branch_id: int | None = None
) -> list[SpendReportRow]:
    """Return ordered and paid totals grouped by branch."""
    scope = _branch_clauses(user, Request.branch_id, branch_id)

    ordered_rows = db.execute(
        select(Request.branch_id, func.coalesce(func.sum(PurchaseOrder.total_amount), 0))
        .join(PurchaseOrder, PurchaseOrder.request_id == Request.id)
        .where(*scope)
        .group_by(Request.branch_id)
    ).all()
    paid_rows = db.execute(
        select(Request.branch_id, func.coalesce(func.sum(Payment.amount), 0))
        .join(Payment, Payment.request_id == Request.id)
        .where(*scope)
        .group_by(Request.branch_id)
    ).all()

    ordered = {branch: _to_decimal(total) for branch, total in ordered_rows}
    paid = {branch: _to_decimal(total) for branch, total in paid_rows}

    branch_ids = set(ordered) | set(paid)
    if branch_ids:
        names = dict(
            db.execute(
                select(Branch.id, Branch.name).where(Branch.id.in_(branch_ids))
            ).all()
        )
    else:
        names = {}

    return [
        SpendReportRow(
            branch_id=bid,
            branch_name=names.get(bid, f"Branch {bid}"),
            total_ordered=ordered.get(bid, Decimal("0")),
            total_paid=paid.get(bid, Decimal("0")),
        )
        for bid in sorted(branch_ids, key=lambda b: names.get(b, str(b)))
    ]


def activity(
    db: Session, user: User, *, branch_id: int | None = None, limit: int = 50
) -> list[ActivityRow]:
    """Return recent audit-trail entries.

    School-role users only see entries tied to their own branches' requests
    (audit rows for issues, write-offs, and contributions are not request-bound
    and are shown to central roles only).
    """
    stmt = select(AuditLog).order_by(AuditLog.id.desc()).limit(limit)
    if not request_service.is_central(user):
        branch_ids = request_service.user_branch_ids(user)
        if branch_id is not None:
            branch_ids = [branch_id] if branch_id in branch_ids else []
        request_ids = select(Request.id).where(Request.branch_id.in_(branch_ids))
        stmt = stmt.where(AuditLog.request_id.in_(request_ids))
    elif branch_id is not None:
        request_ids = select(Request.id).where(Request.branch_id == branch_id)
        stmt = stmt.where(AuditLog.request_id.in_(request_ids))

    logs = db.scalars(stmt).all()
    return [ActivityRow.model_validate(log) for log in logs]
