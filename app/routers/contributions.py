"""Parent contribution endpoints: goods contributed to PRIMARY branches."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.permissions import get_current_user, require_roles
from app.models.contribution import ParentContribution
from app.models.user import Role, User
from app.schemas.contribution import ContributionCreate, ContributionRead
from app.services import inventory_service

router = APIRouter(prefix="/contributions", tags=["contributions"])


@router.post("", response_model=ContributionRead, status_code=201)
def create_contribution(
    payload: ContributionCreate,
    user: User = Depends(require_roles(Role.LIBRARIAN)),
    db: Session = Depends(get_db),
) -> ParentContribution:
    """Record a parent contribution to a PRIMARY branch (LIBRARIAN)."""
    return inventory_service.record_contribution(db, user, payload)


@router.get("", response_model=list[ContributionRead])
def list_contributions(
    branch_id: int | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[ParentContribution]:
    """List parent contributions, optionally filtered by branch."""
    return list(inventory_service.list_contributions(db, user, branch_id=branch_id))
