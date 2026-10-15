"""Pydantic schemas for writing off lost or damaged book copies."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.writeoff import WriteOffReason, WriteOffStatus


class WriteOffCreate(BaseModel):
    """Payload for recording a lost or damaged book copy."""

    book_code: str
    reason: WriteOffReason
    report: str | None = None
    branch_id: int | None = None


class WriteOffDecision(BaseModel):
    """Payload for a Head Master's approve/reject decision."""

    approve: bool
    note: str | None = None


class WriteOffRead(BaseModel):
    """A write-off returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    branch_id: int
    book_copy_id: int
    reported_by_id: int
    reason: WriteOffReason
    report: str | None
    status: WriteOffStatus
    reviewed_by_id: int | None
    reviewed_at: datetime | None
    decision_note: str | None
    created_at: datetime
