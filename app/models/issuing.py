"""Issuing models: loans of book copies and stock items.

An :class:`Issue` records that a librarian lent a book copy (identified by its
unique code) or a quantity of a stock item to a borrower. Returning an issue
stamps ``returned_at``; a returned book copy becomes ``AVAILABLE`` again.
"""

from __future__ import annotations

import enum
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.branch import Branch
    from app.models.inventory import StockItem
    from app.models.library import BookCopy
    from app.models.user import User


class IssueStatus(str, enum.Enum):
    """Whether an issue is still out on loan or has been returned."""

    ISSUED = "ISSUED"
    RETURNED = "RETURNED"


def _utcnow() -> datetime:
    """Return the current UTC time (portable across databases)."""
    return datetime.now(timezone.utc)


class Issue(Base):
    """A loan of a book copy or stock item to a borrower.

    Exactly one of ``book_copy_id`` / ``stock_item_id`` is set. ``quantity`` and
    ``size`` only apply to stock issues.
    """

    __tablename__ = "issues"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    branch_id: Mapped[int] = mapped_column(
        ForeignKey("branches.id"), nullable=False, index=True
    )
    issued_by_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"), nullable=False, index=True
    )
    borrower: Mapped[str] = mapped_column(String(160), nullable=False, index=True)
    book_copy_id: Mapped[int | None] = mapped_column(
        ForeignKey("book_copies.id", ondelete="SET NULL"), nullable=True, index=True
    )
    stock_item_id: Mapped[int | None] = mapped_column(
        ForeignKey("stock_items.id", ondelete="SET NULL"), nullable=True, index=True
    )
    quantity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    size: Mapped[str | None] = mapped_column(String(40), nullable=True)
    status: Mapped[IssueStatus] = mapped_column(
        Enum(IssueStatus, native_enum=False, length=16),
        nullable=False,
        default=IssueStatus.ISSUED,
    )
    returned_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=_utcnow, nullable=False
    )

    branch: Mapped["Branch"] = relationship()
    issued_by: Mapped["User"] = relationship()
    book_copy: Mapped["BookCopy | None"] = relationship()
    stock_item: Mapped["StockItem | None"] = relationship()
