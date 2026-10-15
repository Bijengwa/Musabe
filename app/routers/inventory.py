"""Inventory endpoints: stock levels."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.permissions import get_current_user
from app.models.inventory import StockItem
from app.models.user import User
from app.schemas.inventory import StockItemRead
from app.services import inventory_service

router = APIRouter(prefix="/inventory", tags=["inventory"])


@router.get("", response_model=list[StockItemRead])
def list_inventory(
    branch_id: int | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[StockItem]:
    """List stock levels by item, optionally filtered by branch."""
    return list(inventory_service.list_stock(db, user, branch_id=branch_id))
