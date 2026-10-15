"""Pydantic schemas for requests, request lines, and approvals."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.models.request import (
    ApprovalAction,
    RequestStatus,
    RequestType,
)


class RequestLineCreate(BaseModel):
    """A single requested item supplied when creating a request."""

    description: str
    quantity: int = Field(default=1, ge=1)
    unit: str | None = None


class RequestCreate(BaseModel):
    """Payload for raising a request.

    Central-role users must supply ``branch_id``; school-role users default to
    their own branch.
    """

    type: RequestType
    branch_id: int | None = None
    title: str | None = None
    description: str | None = None
    lines: list[RequestLineCreate] = Field(default_factory=list)


class DecisionRequest(BaseModel):
    """Optional body for approve/reject decisions."""

    comment: str | None = None


class RequestLineRead(BaseModel):
    """A requested item returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    description: str
    quantity: int
    unit: str | None


class ApprovalRead(BaseModel):
    """A recorded approval decision returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    approver_id: int
    action: ApprovalAction
    from_status: RequestStatus
    to_status: RequestStatus
    comment: str | None
    created_at: datetime


class RequestRead(BaseModel):
    """A request, including its lines and approval history."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    type: RequestType
    status: RequestStatus
    branch_id: int
    requestor_id: int
    title: str | None
    description: str | None
    created_at: datetime
    lines: list[RequestLineRead] = Field(default_factory=list)
    approvals: list[ApprovalRead] = Field(default_factory=list)
