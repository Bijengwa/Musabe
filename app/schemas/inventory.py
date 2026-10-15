"""Pydantic schemas for inventory stock levels and movements."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict

from app.models.inventory import StockMovementType


class StockItemRead(BaseModel):
    """A stock level returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    branch_id: int
    item_name: str
    quantity: int
    updated_at: datetime


class StockMovementRead(BaseModel):
    """A stock movement returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    stock_item_id: int
    movement_type: StockMovementType
    quantity: int
    actor_id: int | None
    reference_id: int | None
    note: str | None
    created_at: datetime
