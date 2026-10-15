"""Inventory models: stock items and stock movements.

A :class:`StockItem` tracks the current quantity of one item at one branch.
Every change to a stock level is recorded as a :class:`StockMovement`, so the
current quantity is always reproducible from the movement history.
"""

from __future__ import annotations

import enum
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from sqlalchemy import (
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.branch import Branch
    from app.models.user import User


class StockMovementType(str, enum.Enum):
    """How a stock movement came about.

    ``IN`` (stock received), ``OUT`` (stock consumed/removed), ``PARENT``
    (parent contribution, later phase), ``ADJUST`` (manual correction).
    """

    IN = "IN"
    OUT = "OUT"
    PARENT = "PARENT"
    ADJUST = "ADJUST"


def _utcnow() -> datetime:
    """Return the current UTC time (portable across databases)."""
    return datetime.now(timezone.utc)


class StockItem(Base):
    """The current stock level of one item at one branch."""

    __tablename__ = "stock_items"
    __table_args__ = (
        UniqueConstraint("branch_id", "item_name", name="uq_stock_branch_item"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    branch_id: Mapped[int] = mapped_column(
        ForeignKey("branches.id"), nullable=False, index=True
    )
    item_name: Mapped[str] = mapped_column(String(255), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=_utcnow, nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, default=_utcnow, onupdate=_utcnow, nullable=False
    )

    branch: Mapped["Branch"] = relationship()
    movements: Mapped[list["StockMovement"]] = relationship(
        back_populates="stock_item", cascade="all, delete-orphan"
    )


class StockMovement(Base):
    """An immutable record of a stock level change.

    ``quantity`` is always a positive magnitude; the direction is given by
    ``movement_type``. ``actor_id`` and ``reference_id`` identify who made the
    change and the originating record (for example the request id).
    """

    __tablename__ = "stock_movements"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    stock_item_id: Mapped[int] = mapped_column(
        ForeignKey("stock_items.id", ondelete="CASCADE"), nullable=False, index=True
    )
    movement_type: Mapped[StockMovementType] = mapped_column(
        Enum(StockMovementType, native_enum=False, length=16), nullable=False
    )
    quantity: Mapped[int] = mapped_column(Integer, nullable=False)
    actor_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True, index=True
    )
    reference_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=_utcnow, nullable=False
    )

    stock_item: Mapped["StockItem"] = relationship(back_populates="movements")
    actor: Mapped["User | None"] = relationship()
