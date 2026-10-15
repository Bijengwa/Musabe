"""Write-off endpoints: recording and reviewing lost/damaged copies."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.permissions import get_current_user, require_roles
from app.models.user import Role, User
from app.models.writeoff import WriteOffStatus
from app.schemas.writeoff import WriteOffCreate, WriteOffDecision, WriteOffRead
from app.services import writeoff_service

router = APIRouter(prefix="/write-offs", tags=["writeoff"])


@router.post("", response_model=WriteOffRead, status_code=201)
def create_writeoff(
    payload: WriteOffCreate,
    user: User = Depends(require_roles(Role.LIBRARIAN)),
    db: Session = Depends(get_db),
):
    """Record a lost or damaged book copy as a PENDING write-off (LIBRARIAN)."""
    return writeoff_service.create_writeoff(db, user, payload)


@router.post("/{writeoff_id}/approve", response_model=WriteOffRead)
def decide_writeoff(
    writeoff_id: int,
    payload: WriteOffDecision,
    user: User = Depends(require_roles(Role.HEAD_MASTER)),
    db: Session = Depends(get_db),
):
    """Approve or reject a write-off (HEAD_MASTER of the same branch)."""
    return writeoff_service.decide_writeoff(
        db, user, writeoff_id, approve=payload.approve, note=payload.note
    )


@router.get("", response_model=list[WriteOffRead])
def list_writeoffs(
    status: WriteOffStatus | None = None,
    branch_id: int | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List write-offs, optionally filtered by status and branch."""
    return writeoff_service.list_writeoffs(
        db, user, writeoff_status=status, branch_id=branch_id
    )
