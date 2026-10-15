"""Seed the development database with demo data.

Creates the school branches, an admin, one staff member for every central and
school role, and a supplier. Running it more than once is safe: each record is
looked up by a natural key (branch name / email / supplier name) before creating.

Usage:
    python -m scripts.seed
"""

from __future__ import annotations

import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.core.security import hash_password
from app.models.branch import Branch, BranchType
from app.models.procurement import Supplier
from app.models.user import Role, RoleAssignment, User

BRANCHES: list[tuple[str, BranchType]] = [
    ("Nursery & Primary", BranchType.PRIMARY),
    ("Girls Secondary", BranchType.SECONDARY),
    ("Boys Secondary", BranchType.SECONDARY),
]

ADMIN_FULL_NAME = "System Administrator"
ADMIN_EMAIL = "admin@musabe.ac.ug"
ADMIN_PASSWORD = "admin12345"

#: Shared password for every demo staff account.
DEMO_PASSWORD = "musabe12345"

#: Central staff (not tied to a single branch).
CENTRAL_STAFF: list[tuple[str, str, Role]] = [
    ("Central Manager", "manager@musabe.ac.ug", Role.MANAGER),
    ("Central Bursar", "bursar@musabe.ac.ug", Role.BURSAR),
    ("Central Storekeeper", "storekeeper@musabe.ac.ug", Role.STOREKEEPER),
]

#: School staff created for each branch: (label, email prefix, role).
SCHOOL_STAFF: list[tuple[str, str, Role]] = [
    ("Head Master", "head", Role.HEAD_MASTER),
    ("Academic Master", "academic", Role.ACADEMIC_MASTER),
    ("Librarian", "librarian", Role.LIBRARIAN),
    ("Requesting Staff", "staff", Role.REQUESTING_STAFF),
]

SUPPLIER_NAME = "Musabe General Suppliers"


def _slug(name: str) -> str:
    """Return a lowercase, hyphenated slug for a branch name."""
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def _get_or_create_branch(
    db: Session, name: str, branch_type: BranchType
) -> Branch:
    """Return an existing branch by name, or create it."""
    branch = db.scalar(select(Branch).where(Branch.name == name))
    if branch is None:
        branch = Branch(name=name, type=branch_type)
        db.add(branch)
        db.flush()
    return branch


def _get_or_create_user(
    db: Session, full_name: str, email: str, password: str, assignments: list
) -> User:
    """Return an existing user by email, or create one with ``assignments``."""
    user = db.scalar(select(User).where(User.email == email))
    if user is not None:
        return user
    user = User(
        full_name=full_name,
        email=email,
        password_hash=hash_password(password),
        is_active=True,
    )
    user.assignments = assignments
    db.add(user)
    db.flush()
    return user


def _get_or_create_supplier(db: Session, name: str) -> Supplier:
    """Return an existing supplier by name, or create it."""
    supplier = db.scalar(select(Supplier).where(Supplier.name == name))
    if supplier is None:
        supplier = Supplier(
            name=name,
            contact_person="Musabe Sales Desk",
            phone="+256 700 000000",
            email="sales@musabe.example",
            address="Kampala, Uganda",
        )
        db.add(supplier)
        db.flush()
    return supplier


def seed(db: Session, *, verbose: bool = True) -> None:
    """Populate branches, staff, and a supplier if they do not already exist."""
    branches = [_get_or_create_branch(db, name, t) for name, t in BRANCHES]

    admin = _get_or_create_user(
        db,
        ADMIN_FULL_NAME,
        ADMIN_EMAIL,
        ADMIN_PASSWORD,
        [RoleAssignment(role=Role.ADMIN, branch_id=None)],
    )

    for full_name, email, role in CENTRAL_STAFF:
        _get_or_create_user(
            db, full_name, email, DEMO_PASSWORD,
            [RoleAssignment(role=role, branch_id=None)],
        )

    for branch in branches:
        slug = _slug(branch.name)
        for label, prefix, role in SCHOOL_STAFF:
            _get_or_create_user(
                db,
                f"{label} - {branch.name}",
                f"{prefix}.{slug}@musabe.ac.ug",
                DEMO_PASSWORD,
                [RoleAssignment(role=role, branch_id=branch.id)],
            )

    _get_or_create_supplier(db, SUPPLIER_NAME)
    db.commit()

    if not verbose:
        return
    print(f"Seeded {len(branches)} branches and a supplier.")
    print(f"Admin:        {admin.email} / {ADMIN_PASSWORD}")
    print(f"Central:      manager@musabe.ac.ug, bursar@musabe.ac.ug, "
          f"storekeeper@musabe.ac.ug / {DEMO_PASSWORD}")
    print("School staff (per branch):")
    for branch in branches:
        slug = _slug(branch.name)
        print(
            f"  {branch.name}: head.{slug}, academic.{slug}, "
            f"librarian.{slug}, staff.{slug}@musabe.ac.ug"
        )


def main() -> None:
    """Open a session and run the seed routine."""
    db = SessionLocal()
    try:
        seed(db)
    finally:
        db.close()


if __name__ == "__main__":
    main()
