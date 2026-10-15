"""Admin service: branch and staff management."""

from __future__ import annotations

from collections.abc import Sequence

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.core.security import hash_password
from app.models.branch import Branch
from app.models.user import CENTRAL_ROLES, Role, RoleAssignment, User
from app.schemas.branch import BranchCreate
from app.schemas.user import StaffCreate, StaffUpdate


def list_branches(db: Session) -> Sequence[Branch]:
    """Return all branches ordered by name."""
    return db.scalars(select(Branch).order_by(Branch.name)).all()


def create_branch(db: Session, data: BranchCreate) -> Branch:
    """Create a branch.

    Raises:
        HTTPException: 409 if a branch with the same name already exists.
    """
    existing = db.scalar(select(Branch).where(Branch.name == data.name))
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Branch name already exists",
        )
    branch = Branch(name=data.name, type=data.type)
    db.add(branch)
    db.commit()
    db.refresh(branch)
    return branch


def _load_branches(db: Session, branch_ids: Sequence[int]) -> list[Branch]:
    """Load branches for ``branch_ids``, raising 404 if any are missing."""
    if not branch_ids:
        return []
    unique_ids = list(dict.fromkeys(branch_ids))
    branches = list(
        db.scalars(select(Branch).where(Branch.id.in_(unique_ids))).all()
    )
    if len(branches) != len(unique_ids):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="One or more branches were not found",
        )
    return branches


def _build_assignments(
    db: Session, role: Role, branch_ids: Sequence[int]
) -> list[RoleAssignment]:
    """Build role assignments for ``role``, validating branch requirements."""
    if role in CENTRAL_ROLES:
        return [RoleAssignment(role=role, branch_id=None)]
    if not branch_ids:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="School roles require at least one branch",
        )
    branches = _load_branches(db, branch_ids)
    return [RoleAssignment(role=role, branch_id=branch.id) for branch in branches]


def list_staff(db: Session) -> Sequence[User]:
    """Return all users with their role assignments loaded."""
    stmt = select(User).options(selectinload(User.assignments)).order_by(User.id)
    return db.scalars(stmt).all()


def create_staff(db: Session, data: StaffCreate) -> User:
    """Create a staff user and their role assignments.

    Raises:
        HTTPException: 409 if the email is already registered, or 400/404 for
            invalid role/branch combinations.
    """
    existing = db.scalar(select(User).where(User.email == data.email))
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Email already registered",
        )

    assignments = _build_assignments(db, data.role, data.branch_ids)
    user = User(
        full_name=data.full_name,
        email=data.email,
        password_hash=hash_password(data.password),
        is_active=True,
    )
    user.assignments = assignments
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def get_staff(db: Session, user_id: int) -> User:
    """Return a staff user by id.

    Raises:
        HTTPException: 404 if the user does not exist.
    """
    user = db.get(User, user_id)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Staff member not found",
        )
    return user


def update_staff(db: Session, user_id: int, data: StaffUpdate) -> User:
    """Update a staff member's role, branch assignments, and/or active status.

    Raises:
        HTTPException: 404 if the user or a branch is missing, or 400 for an
            invalid role/branch combination.
    """
    user = get_staff(db, user_id)

    if data.is_active is not None:
        user.is_active = data.is_active

    if data.role is not None or data.branch_ids is not None:
        if data.role is not None:
            role = data.role
        elif user.assignments:
            role = user.assignments[0].role
        else:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A role is required",
            )

        if data.branch_ids is not None:
            branch_ids = data.branch_ids
        else:
            branch_ids = [
                a.branch_id for a in user.assignments if a.branch_id is not None
            ]
        user.assignments = _build_assignments(db, role, branch_ids)

    db.commit()
    db.refresh(user)
    return user
