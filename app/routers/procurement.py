"""Procurement endpoints: suppliers and the request purchase pipeline.

Business logic lives in :mod:`app.services.procurement_service`; these
handlers only translate HTTP to service calls. Request-scoped actions return
the updated request.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.permissions import get_current_user, require_roles
from app.models.procurement import Supplier
from app.models.request import Request
from app.models.user import Role, User
from app.schemas.procurement import (
    DeliveryCreate,
    ManagerDecision,
    PaymentCreate,
    PurchaseOrderCreate,
    RequisitionCreate,
    VerificationCreate,
)
from app.schemas.request import RequestRead
from app.schemas.supplier import SupplierCreate, SupplierRead
from app.services import procurement_service

router = APIRouter(tags=["procurement"])


# --------------------------------------------------------------------------- #
# Suppliers
# --------------------------------------------------------------------------- #
@router.post("/suppliers", response_model=SupplierRead, status_code=201)
def create_supplier(
    payload: SupplierCreate,
    user: User = Depends(require_roles(Role.ADMIN, Role.BURSAR)),
    db: Session = Depends(get_db),
) -> Supplier:
    """Register a supplier (ADMIN or BURSAR)."""
    return procurement_service.create_supplier(db, payload)


@router.get("/suppliers", response_model=list[SupplierRead])
def list_suppliers(
    user: User = Depends(require_roles(Role.ADMIN, Role.BURSAR)),
    db: Session = Depends(get_db),
) -> list[Supplier]:
    """List suppliers (ADMIN or BURSAR)."""
    return list(procurement_service.list_suppliers(db))


# --------------------------------------------------------------------------- #
# Request pipeline
# --------------------------------------------------------------------------- #
@router.post("/requests/{request_id}/requisition", response_model=RequestRead)
def create_requisition(
    request_id: int,
    payload: RequisitionCreate | None = None,
    user: User = Depends(require_roles(Role.LIBRARIAN)),
    db: Session = Depends(get_db),
) -> Request:
    """Raise a requisition for an approved BOOK or OTHER request (LIBRARIAN)."""
    data = payload if payload is not None else RequisitionCreate()
    return procurement_service.create_requisition(db, user, request_id, data)


@router.post("/requests/{request_id}/purchase-order", response_model=RequestRead)
def create_purchase_order(
    request_id: int,
    payload: PurchaseOrderCreate,
    user: User = Depends(require_roles(Role.BURSAR)),
    db: Session = Depends(get_db),
) -> Request:
    """Create a purchase order with a supplier and total (BURSAR)."""
    return procurement_service.create_purchase_order(db, user, request_id, payload)


@router.post("/requests/{request_id}/manager-approval", response_model=RequestRead)
def manager_approval(
    request_id: int,
    payload: ManagerDecision,
    user: User = Depends(require_roles(Role.MANAGER)),
    db: Session = Depends(get_db),
) -> Request:
    """Approve or reject a request at PENDING_MANAGER (MANAGER)."""
    return procurement_service.manager_decision(db, user, request_id, payload)


@router.post("/requests/{request_id}/order", response_model=RequestRead)
def place_order(
    request_id: int,
    user: User = Depends(require_roles(Role.STOREKEEPER)),
    db: Session = Depends(get_db),
) -> Request:
    """Place the order with the supplier (STOREKEEPER)."""
    return procurement_service.place_order(db, user, request_id)


@router.post("/requests/{request_id}/receive", response_model=RequestRead)
def receive_delivery(
    request_id: int,
    payload: DeliveryCreate | None = None,
    user: User = Depends(require_roles(Role.STOREKEEPER)),
    db: Session = Depends(get_db),
) -> Request:
    """Receive a delivery from the supplier (STOREKEEPER only)."""
    data = payload if payload is not None else DeliveryCreate()
    return procurement_service.receive_delivery(db, user, request_id, data)


@router.post("/requests/{request_id}/verify", response_model=RequestRead)
def verify_delivery(
    request_id: int,
    payload: VerificationCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> Request:
    """Verify a delivery (original requestor only).

    ``matched=false`` moves the request to DISPUTED.
    """
    return procurement_service.verify_delivery(db, user, request_id, payload)


@router.post("/requests/{request_id}/pay", response_model=RequestRead)
def make_payment(
    request_id: int,
    payload: PaymentCreate | None = None,
    user: User = Depends(require_roles(Role.BURSAR)),
    db: Session = Depends(get_db),
) -> Request:
    """Record a payment once the request is VERIFIED (BURSAR)."""
    data = payload if payload is not None else PaymentCreate()
    return procurement_service.make_payment(db, user, request_id, data)


@router.post("/requests/{request_id}/send-to-school", response_model=RequestRead)
def send_to_school(
    request_id: int,
    user: User = Depends(require_roles(Role.STOREKEEPER)),
    db: Session = Depends(get_db),
) -> Request:
    """Send a paid BOOK request to the school (STOREKEEPER)."""
    return procurement_service.send_to_school(db, user, request_id)


@router.post("/requests/{request_id}/move-to-store", response_model=RequestRead)
def move_to_store(
    request_id: int,
    user: User = Depends(require_roles(Role.LIBRARIAN)),
    db: Session = Depends(get_db),
) -> Request:
    """Move a paid OTHER request into the store (LIBRARIAN)."""
    return procurement_service.move_to_store(db, user, request_id)
