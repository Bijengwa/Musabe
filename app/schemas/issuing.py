"""Pydantic schemas for issuing book copies and stock items."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.issuing import IssueStatus


class IssueCreate(BaseModel):
    """Payload for issuing a book copy or a stock item.

    Provide exactly one of ``book_code`` (a book copy) or ``item_name`` (a
    stock item). For stock issues, ``quantity`` and/or ``size`` identify what
    is being issued.
    """

    borrower: str
    branch_id: int | None = None
    book_code: str | None = None
    item_name: str | None = None
    quantity: int | None = Field(default=None, ge=1)
    size: str | None = None


class IssueRead(BaseModel):
    """An issue returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    branch_id: int
    issued_by_id: int
    borrower: str
    book_copy_id: int | None
    stock_item_id: int | None
    quantity: int | None
    size: str | None
    status: IssueStatus
    returned_at: datetime | None
    created_at: datetime
