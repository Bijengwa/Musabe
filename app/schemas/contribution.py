"""Pydantic schemas for parent contributions."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field


class ContributionCreate(BaseModel):
    """Payload for recording a parent contribution to a PRIMARY branch."""

    item_name: str
    quantity: int = Field(ge=1)
    contributor: str | None = None
    note: str | None = None
    branch_id: int | None = None


class ContributionRead(BaseModel):
    """A parent contribution returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    branch_id: int
    recorded_by_id: int
    contributor: str | None
    item_name: str
    quantity: int
    note: str | None
    created_at: datetime
