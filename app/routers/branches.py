"""Branch directory endpoints."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.permissions import get_current_user
from app.models.branch import Branch
from app.models.user import User
from app.schemas.branch import BranchRead

router = APIRouter(prefix="/branches", tags=["branches"])


@router.get("", response_model=list[BranchRead])
def list_branches(
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[Branch]:
    """List all branches (id, name, type) for any authenticated user.

    School roles need branch names for labels; central roles need the list
    when creating requests on behalf of a school.
    """
    return list(db.scalars(select(Branch).order_by(Branch.id)))
