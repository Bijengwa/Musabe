"""Pydantic schemas for branches."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict

from app.models.branch import BranchType


class BranchCreate(BaseModel):
    """Payload for creating a branch."""

    name: str
    type: BranchType


class BranchRead(BaseModel):
    """Branch representation returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    type: BranchType
    is_active: bool
