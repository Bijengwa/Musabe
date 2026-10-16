"""Pydantic schemas for management reports."""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict

from app.models.request import RequestStatus, RequestType


class StatusCount(BaseModel):
    """A count of records sharing one status."""

    status: str
    count: int


class ReportsOverview(BaseModel):
    """A dashboard summary across requests, library, store, and spend."""

    total_requests: int
    pending_requests: int
    requests_by_status: list[StatusCount]
    total_book_copies: int
    book_copies_by_status: list[StatusCount]
    stock_items: int
    low_stock_items: int
    outstanding_issues: int
    pending_writeoffs: int
    total_contributions: int
    total_ordered: Decimal
    total_paid: Decimal


class PendingRequestRow(BaseModel):
    """A request that is not yet in a terminal state."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    type: RequestType
    status: RequestStatus
    branch_id: int
    requestor_id: int
    title: str | None
    created_at: datetime


class ActionItem(BaseModel):
    """One pending task the signed-in user can act on, based on their roles."""

    kind: str
    id: int
    label: str
    status: str
    action: str
    branch_id: int
    route: str
    created_at: datetime


class StockReportRow(BaseModel):
    """A stock level with a low-stock flag."""

    id: int
    branch_id: int
    item_name: str
    quantity: int
    is_low: bool


class OutstandingIssueRow(BaseModel):
    """An issue that has not yet been returned."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    branch_id: int
    borrower: str
    book_copy_id: int | None
    stock_item_id: int | None
    quantity: int | None
    size: str | None
    created_at: datetime


class SpendReportRow(BaseModel):
    """Ordered and paid totals for one branch."""

    branch_id: int
    branch_name: str
    total_ordered: Decimal
    total_paid: Decimal


class ActivityRow(BaseModel):
    """A recent audit-trail entry."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    request_id: int | None
    actor_id: int | None
    action: str
    from_status: str | None
    to_status: str | None
    detail: str | None
    created_at: datetime
