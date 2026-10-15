"""Branch model and branch type enumeration."""

from __future__ import annotations

import enum

from sqlalchemy import Boolean, Enum, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base


class BranchType(str, enum.Enum):
    """Whether a branch is a primary or secondary school."""

    PRIMARY = "PRIMARY"
    SECONDARY = "SECONDARY"


class Branch(Base):
    """A school branch (Nursery & Primary, Girls Secondary, ...)."""

    __tablename__ = "branches"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(120), unique=True, index=True)
    type: Mapped[BranchType] = mapped_column(
        Enum(BranchType, native_enum=False, length=16)
    )
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)

    assignments: Mapped[list["RoleAssignment"]] = relationship(
        back_populates="branch"
    )
