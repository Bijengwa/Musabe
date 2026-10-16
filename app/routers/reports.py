"""Reports endpoints: read-only management dashboards."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.permissions import get_current_user
from app.models.user import User
from app.schemas.reports import (
    ActionItem,
    ActivityRow,
    OutstandingIssueRow,
    PendingRequestRow,
    ReportsOverview,
    SpendReportRow,
    StockReportRow,
)
from app.services import reports_service

router = APIRouter(prefix="/reports", tags=["reports"])


@router.get("/overview", response_model=ReportsOverview)
def get_overview(
    branch_id: int | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> ReportsOverview:
    """Return a dashboard summary scoped to the user's branches."""
    return reports_service.overview(db, user, branch_id=branch_id)


@router.get("/my-actions", response_model=list[ActionItem])
def get_my_actions(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ActionItem]:
    """List the pending tasks the current user can act on, by role."""
    return reports_service.my_actions(db, user)


@router.get("/pending-requests", response_model=list[PendingRequestRow])
def get_pending_requests(
    branch_id: int | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[PendingRequestRow]:
    """List requests that have not yet reached a terminal status."""
    return reports_service.pending_requests(db, user, branch_id=branch_id)


@router.get("/stock", response_model=list[StockReportRow])
def get_stock_report(
    branch_id: int | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[StockReportRow]:
    """List stock levels with a low-stock flag."""
    return reports_service.stock_report(db, user, branch_id=branch_id)


@router.get("/outstanding-issues", response_model=list[OutstandingIssueRow])
def get_outstanding_issues(
    branch_id: int | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[OutstandingIssueRow]:
    """List book/stock issues that have not yet been returned."""
    return reports_service.outstanding_issues(db, user, branch_id=branch_id)


@router.get("/spend", response_model=list[SpendReportRow])
def get_spend_report(
    branch_id: int | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[SpendReportRow]:
    """Return ordered and paid totals grouped by branch."""
    return reports_service.spend_report(db, user, branch_id=branch_id)


@router.get("/activity", response_model=list[ActivityRow])
def get_activity(
    branch_id: int | None = None,
    limit: int = 50,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ActivityRow]:
    """Return recent audit-trail entries."""
    return reports_service.activity(db, user, branch_id=branch_id, limit=limit)
