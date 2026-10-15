"""Parent contribution model.

A :class:`ParentContribution` records goods contributed by a parent to a
PRIMARY branch. Each contribution increases branch stock through a ``PARENT``
:class:`~app.models.inventory.StockMovement`.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.branch import Branch
    from app.models.user import User


def _utcnow() -> datetime:
    """Return the current UTC time (portable across databases)."""
    return datetime.now(timezone.utc)


class ParentContribution(Base):
    """Goods contributed by a parent to a PRIMARY branch."""

    __tablename__ = "parent_contributions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    branch_id: Mapped[int] = mapped_column(
        ForeignKey("branches.id"), nullable=False, index=True
    )
    recorded_by_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"), nullable=False, index=True
    )
    contributor: Mapped[str | None] = mapped_column(String(160), nullable=True)
    item_name: Mapped[str] = mapped_column(String(255), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=_utcnow, nullable=False
    )

    branch: Mapped["Branch"] = relationship()
    recorded_by: Mapped["User"] = relationship()
