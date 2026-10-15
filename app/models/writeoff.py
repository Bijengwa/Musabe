"""Write-off models: lost or damaged book copies awaiting approval.

A librarian records a lost or damaged copy as a :class:`WriteOff` with a reason
and a report; the Head Master of the same branch then approves or rejects it.
Approval marks the copy ``WRITTEN_OFF``; rejection leaves the copy unchanged.
"""

from __future__ import annotations

import enum
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.branch import Branch
    from app.models.library import BookCopy
    from app.models.user import User


class WriteOffReason(str, enum.Enum):
    """Why a book copy is being written off."""

    LOST = "LOST"
    DAMAGED = "DAMAGED"


class WriteOffStatus(str, enum.Enum):
    """Lifecycle of a write-off request."""

    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"


def _utcnow() -> datetime:
    """Return the current UTC time (portable across databases)."""
    return datetime.now(timezone.utc)


class WriteOff(Base):
    """A request to write off a lost or damaged book copy."""

    __tablename__ = "write_offs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    branch_id: Mapped[int] = mapped_column(
        ForeignKey("branches.id"), nullable=False, index=True
    )
    book_copy_id: Mapped[int] = mapped_column(
        ForeignKey("book_copies.id", ondelete="CASCADE"), nullable=False, index=True
    )
    reported_by_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"), nullable=False, index=True
    )
    reason: Mapped[WriteOffReason] = mapped_column(
        Enum(WriteOffReason, native_enum=False, length=16), nullable=False
    )
    report: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[WriteOffStatus] = mapped_column(
        Enum(WriteOffStatus, native_enum=False, length=16),
        nullable=False,
        default=WriteOffStatus.PENDING,
    )
    reviewed_by_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True, index=True
    )
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    decision_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=_utcnow, nullable=False
    )

    branch: Mapped["Branch"] = relationship()
    book_copy: Mapped["BookCopy"] = relationship()
    reported_by: Mapped["User"] = relationship(foreign_keys=[reported_by_id])
    reviewed_by: Mapped["User | None"] = relationship(foreign_keys=[reviewed_by_id])
