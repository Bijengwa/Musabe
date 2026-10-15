"""Pydantic schemas for users, staff, and role assignments."""

from __future__ import annotations

from pydantic import BaseModel, ConfigDict, Field

from app.models.user import Role


class RoleAssignmentRead(BaseModel):
    """A single role assignment returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    role: Role
    branch_id: int | None


class StaffCreate(BaseModel):
    """Payload for creating a staff member.

    Central roles ignore ``branch_ids`` (assignments are global); school
    roles require at least one branch.
    """

    full_name: str
    email: str
    password: str
    role: Role
    branch_ids: list[int] = Field(default_factory=list)


class StaffUpdate(BaseModel):
    """Payload for updating a staff member's role, branches, or status."""

    role: Role | None = None
    branch_ids: list[int] | None = None
    is_active: bool | None = None


class StaffRead(BaseModel):
    """Staff member representation returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    full_name: str
    email: str
    is_active: bool
    assignments: list[RoleAssignmentRead] = Field(default_factory=list)


class UserRead(BaseModel):
    """Authenticated user representation returned by ``/auth/me``."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    full_name: str
    email: str
    is_active: bool
    assignments: list[RoleAssignmentRead] = Field(default_factory=list)
