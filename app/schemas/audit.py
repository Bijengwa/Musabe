"""Pydantic schemas for audit log entries."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict


class AuditLogRead(BaseModel):
    """An audit log entry returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    request_id: int | None
    actor_id: int | None
    action: str
    from_status: str | None
    to_status: str | None
    detail: str | None
    created_at: datetime
