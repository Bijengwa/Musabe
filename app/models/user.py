"""User and role assignment models."""

from __future__ import annotations

import enum
from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Enum, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.branch import Branch


class Role(str, enum.Enum):
    """Roles in the system (central and school)."""

    ADMIN = "ADMIN"
    MANAGER = "MANAGER"
    BURSAR = "BURSAR"
    STOREKEEPER = "STOREKEEPER"
    HEAD_MASTER = "HEAD_MASTER"
    ACADEMIC_MASTER = "ACADEMIC_MASTER"
    LIBRARIAN = "LIBRARIAN"
    REQUESTING_STAFF = "REQUESTING_STAFF"


CENTRAL_ROLES: frozenset[Role] = frozenset(
    {Role.ADMIN, Role.MANAGER, Role.BURSAR, Role.STOREKEEPER}
)
SCHOOL_ROLES: frozenset[Role] = frozenset(
    {
        Role.HEAD_MASTER,
        Role.ACADEMIC_MASTER,
        Role.LIBRARIAN,
        Role.REQUESTING_STAFF,
    }
)


class User(Base):
    """A system user (central or school staff)."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    full_name: Mapped[str] = mapped_column(String(160), nullable=False)
    email: Mapped[str] = mapped_column(
        String(255), unique=True, index=True, nullable=False
    )
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    assignments: Mapped[list["RoleAssignment"]] = relationship(
        back_populates="user",
        cascade="all, delete-orphan",
    )


class RoleAssignment(Base):
    """Assigns a role to a user, optionally scoped to a single branch.

    Central roles use ``branch_id = NULL`` and apply across all branches.
    """

    __tablename__ = "role_assignments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(
        ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[Role] = mapped_column(Enum(Role, native_enum=False, length=32))
    branch_id: Mapped[int | None] = mapped_column(
        ForeignKey("branches.id"), nullable=True, index=True
    )

    user: Mapped["User"] = relationship(back_populates="assignments")
    branch: Mapped["Branch | None"] = relationship(back_populates="assignments")
