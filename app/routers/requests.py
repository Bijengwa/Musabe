"""Request and approval endpoints.

Business logic lives in :mod:`app.services.request_service`; these handlers
only translate HTTP to service calls.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.permissions import get_current_user
from app.models.request import Request
from app.models.user import User
from app.schemas.request import DecisionRequest, RequestCreate, RequestRead
from app.services import request_service

router = APIRouter(prefix="/requests", tags=["requests"])


@router.post("", response_model=RequestRead, status_code=201)
def create_request(
    payload: RequestCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Request:
    """Raise a new BOOK or OTHER request."""
    return request_service.create_request(db, user, payload)


@router.get("", response_model=list[RequestRead])
def list_requests(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[Request]:
    """List requests visible to the current user (branch-scoped)."""
    return list(request_service.list_requests(db, user))


@router.get("/{request_id}", response_model=RequestRead)
def get_request(
    request_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Request:
    """Return a single request if it is visible to the current user."""
    return request_service.get_request(db, user, request_id)


@router.post("/{request_id}/approve", response_model=RequestRead)
def approve_request(
    request_id: int,
    payload: DecisionRequest | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Request:
    """Approve the current step of a request."""
    comment = payload.comment if payload is not None else None
    return request_service.approve_request(db, user, request_id, comment)


@router.post("/{request_id}/reject", response_model=RequestRead)
def reject_request(
    request_id: int,
    payload: DecisionRequest | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Request:
    """Reject a request, ending its workflow."""
    comment = payload.comment if payload is not None else None
    return request_service.reject_request(db, user, request_id, comment)
