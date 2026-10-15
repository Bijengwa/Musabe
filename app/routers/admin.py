"""Admin endpoints (ADMIN only): branch and staff management."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.permissions import require_roles
from app.models.branch import Branch
from app.models.user import Role, User
from app.schemas.branch import BranchCreate, BranchRead
from app.schemas.user import StaffCreate, StaffRead, StaffUpdate
from app.services import admin_service

router = APIRouter(
    prefix="/admin",
    tags=["admin"],
    dependencies=[Depends(require_roles(Role.ADMIN))],
)


@router.post("/branches", response_model=BranchRead, status_code=201)
def create_branch(
    payload: BranchCreate, db: Session = Depends(get_db)
) -> Branch:
    """Create a new branch."""
    return admin_service.create_branch(db, payload)


@router.get("/branches", response_model=list[BranchRead])
def list_branches(db: Session = Depends(get_db)) -> list[Branch]:
    """List all branches."""
    return list(admin_service.list_branches(db))


@router.post("/staff", response_model=StaffRead, status_code=201)
def create_staff(payload: StaffCreate, db: Session = Depends(get_db)) -> User:
    """Create a staff member with a role and one or more branch assignments."""
    return admin_service.create_staff(db, payload)


@router.get("/staff", response_model=list[StaffRead])
def list_staff(db: Session = Depends(get_db)) -> list[User]:
    """List all staff members with their role assignments."""
    return list(admin_service.list_staff(db))


@router.patch("/staff/{staff_id}", response_model=StaffRead)
def update_staff(
    staff_id: int, payload: StaffUpdate, db: Session = Depends(get_db)
) -> User:
    """Update a staff member's role, branch assignments, or active status."""
    return admin_service.update_staff(db, staff_id, payload)
