"""Procurement service: suppliers, requisitions, POs, delivery, payment.

Every request status change in this module goes through
:func:`app.services.workflow.apply_transition` and writes an ``audit_logs``
row via :mod:`app.services.audit_service`. Request status is never assigned
directly from anything other than the value returned by the workflow engine.

Branch scoping is delegated to :func:`app.services.request_service.get_request`,
so school-role users can only act on their own branch's requests while central
roles act on any request.
"""

from __future__ import annotations

from collections.abc import Sequence

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.procurement import (
    Delivery,
    Payment,
    PurchaseOrder,
    Requisition,
    Supplier,
    Verification,
)
from app.models.request import Request, RequestStatus
from app.models.user import Role, User
from app.schemas.procurement import (
    DeliveryCreate,
    ManagerDecision,
    PaymentCreate,
    PurchaseOrderCreate,
    RequisitionCreate,
    VerificationCreate,
)
from app.schemas.supplier import SupplierCreate
from app.services import audit_service, inventory_service, request_service, workflow
from app.services.workflow import WorkflowAction


def _roles(user: User) -> set[Role]:
    """Return the set of roles held by ``user``."""
    return {assignment.role for assignment in user.assignments}


def _plan(
    user: User, request: Request, action: WorkflowAction
) -> RequestStatus:
    """Validate a transition and return the next status (no mutation)."""
    return workflow.apply_transition(
        request_type=request.type,
        current_status=request.status,
        action=action,
        roles=_roles(user),
    )


def _commit_transition(
    db: Session,
    user: User,
    request: Request,
    action: WorkflowAction,
    new_status: RequestStatus,
    detail: str | None = None,
) -> None:
    """Apply a validated status change and record it in the audit log."""
    from_status = request.status
    request.status = new_status
    audit_service.log_action(
        db,
        action=action.value,
        request_id=request.id,
        actor_id=user.id,
        from_status=from_status.value,
        to_status=new_status.value,
        detail=detail,
    )


def _finish(db: Session, request: Request) -> Request:
    """Commit pending changes and return the refreshed request."""
    db.commit()
    db.refresh(request)
    return request


# --------------------------------------------------------------------------- #
# Suppliers
# --------------------------------------------------------------------------- #
def list_suppliers(db: Session) -> Sequence[Supplier]:
    """Return all suppliers ordered by name."""
    return db.scalars(select(Supplier).order_by(Supplier.name)).all()


def create_supplier(db: Session, data: SupplierCreate) -> Supplier:
    """Register a new supplier.

    Raises:
        HTTPException: 409 if a supplier with the same name exists.
    """
    existing = db.scalar(select(Supplier).where(Supplier.name == data.name))
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Supplier name already exists",
        )
    supplier = Supplier(
        name=data.name,
        contact_person=data.contact_person,
        phone=data.phone,
        email=data.email,
        address=data.address,
        is_active=True,
    )
    db.add(supplier)
    db.commit()
    db.refresh(supplier)
    return supplier


# --------------------------------------------------------------------------- #
# Requisition (both flows)
# --------------------------------------------------------------------------- #
def create_requisition(
    db: Session, user: User, request_id: int, data: RequisitionCreate
) -> Request:
    """Raise a requisition, moving an approved request to PENDING_BURSAR.

    Used for BOOK requests after Head Master approval and for OTHER requests
    after Academic Master or Head Master approval.

    Raises:
        HTTPException: 404 if the request is not visible, or 409/403 from the
            workflow engine when the request is not awaiting a requisition.
    """
    request = request_service.get_request(db, user, request_id)

    new_status = _plan(user, request, WorkflowAction.REQUISITION)
    db.add(
        Requisition(
            request_id=request.id, created_by_id=user.id, notes=data.notes
        )
    )
    _commit_transition(
        db, user, request, WorkflowAction.REQUISITION, new_status, data.notes
    )
    return _finish(db, request)


# --------------------------------------------------------------------------- #
# Purchase order (both flows)
# --------------------------------------------------------------------------- #
def _generate_po_number(db: Session, request_id: int) -> str:
    """Return a unique purchase-order number for ``request_id``."""
    count = db.scalar(
        select(func.count())
        .select_from(PurchaseOrder)
        .where(PurchaseOrder.request_id == request_id)
    )
    return f"PO-{request_id:06d}-{(count or 0) + 1:02d}"


def create_purchase_order(
    db: Session, user: User, request_id: int, data: PurchaseOrderCreate
) -> Request:
    """Create a purchase order, moving the request to PENDING_MANAGER.

    Raises:
        HTTPException: 404 if the request or supplier is missing, 409 if the
            request is not awaiting a purchase order, or 403 for a wrong role.
    """
    request = request_service.get_request(db, user, request_id)
    supplier = db.get(Supplier, data.supplier_id)
    if supplier is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Supplier not found",
        )

    new_status = _plan(user, request, WorkflowAction.PURCHASE_ORDER)
    db.add(
        PurchaseOrder(
            request_id=request.id,
            supplier_id=supplier.id,
            created_by_id=user.id,
            po_number=_generate_po_number(db, request.id),
            total_amount=data.total_amount,
        )
    )
    _commit_transition(
        db, user, request, WorkflowAction.PURCHASE_ORDER, new_status
    )
    return _finish(db, request)


# --------------------------------------------------------------------------- #
# Manager decision (both flows)
# --------------------------------------------------------------------------- #
def manager_decision(
    db: Session, user: User, request_id: int, data: ManagerDecision
) -> Request:
    """Apply the Manager's approve/reject decision to a request."""
    request = request_service.get_request(db, user, request_id)
    action = (
        WorkflowAction.APPROVE if data.approve else WorkflowAction.REJECT
    )
    new_status = _plan(user, request, action)
    _commit_transition(db, user, request, action, new_status, data.comment)
    return _finish(db, request)


# --------------------------------------------------------------------------- #
# Order (both flows)
# --------------------------------------------------------------------------- #
def place_order(db: Session, user: User, request_id: int) -> Request:
    """Place the order with the supplier, moving the request to ORDERED."""
    request = request_service.get_request(db, user, request_id)
    new_status = _plan(user, request, WorkflowAction.ORDER)
    _commit_transition(db, user, request, WorkflowAction.ORDER, new_status)
    return _finish(db, request)


# --------------------------------------------------------------------------- #
# Receive delivery (both flows)
# --------------------------------------------------------------------------- #
def receive_delivery(
    db: Session, user: User, request_id: int, data: DeliveryCreate
) -> Request:
    """Record a delivery, moving the request to RECEIVED.

    Only the Storekeeper role is permitted (enforced by the workflow and the
    endpoint).
    """
    request = request_service.get_request(db, user, request_id)
    new_status = _plan(user, request, WorkflowAction.RECEIVE)
    db.add(
        Delivery(
            request_id=request.id,
            received_by_id=user.id,
            delivery_note=data.delivery_note,
        )
    )
    _commit_transition(
        db, user, request, WorkflowAction.RECEIVE, new_status, data.delivery_note
    )
    return _finish(db, request)


# --------------------------------------------------------------------------- #
# Verify delivery (original requestor only)
# --------------------------------------------------------------------------- #
def verify_delivery(
    db: Session, user: User, request_id: int, data: VerificationCreate
) -> Request:
    """Verify a delivery as the original requestor.

    The verification is identity-based: only the user who raised the request
    may verify it, regardless of role.

    Raises:
        HTTPException: 403 if ``user`` is not the requestor, 404 if the request
            is not visible, or 409 if it is not awaiting verification.
    """
    request = request_service.get_request(db, user, request_id)
    if request.requestor_id != user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only the original requestor can verify this request",
        )

    action = (
        WorkflowAction.VERIFY_TRUE
        if data.matched
        else WorkflowAction.VERIFY_FALSE
    )
    new_status = _plan(user, request, action)
    db.add(
        Verification(
            request_id=request.id,
            verified_by_id=user.id,
            matched=data.matched,
            note=data.note,
        )
    )
    _commit_transition(db, user, request, action, new_status, data.note)
    return _finish(db, request)


# --------------------------------------------------------------------------- #
# Payment (both flows)
# --------------------------------------------------------------------------- #
def make_payment(
    db: Session, user: User, request_id: int, data: PaymentCreate
) -> Request:
    """Record a payment, moving the request to PAID.

    Payment is only allowed once the request is VERIFIED (enforced by the
    workflow). The amount defaults to the linked purchase order total.

    Raises:
        HTTPException: 400 if no amount can be determined, 404 if the request
            is missing, or 409 if the request is not VERIFIED.
    """
    request = request_service.get_request(db, user, request_id)

    # Validate the step before computing the amount so an invalid status is
    # reported consistently (409) and never partially mutated.
    new_status = _plan(user, request, WorkflowAction.PAY)

    amount = data.amount
    if amount is None:
        purchase_order = db.scalar(
            select(PurchaseOrder)
            .where(PurchaseOrder.request_id == request.id)
            .order_by(PurchaseOrder.id.desc())
        )
        if purchase_order is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No purchase order found to determine the payment amount",
            )
        amount = purchase_order.total_amount

    db.add(
        Payment(
            request_id=request.id,
            paid_by_id=user.id,
            amount=amount,
            reference=data.reference,
        )
    )
    _commit_transition(
        db, user, request, WorkflowAction.PAY, new_status, data.reference
    )
    return _finish(db, request)


# --------------------------------------------------------------------------- #
# Final handoff (BOOK -> school, OTHER -> store)
# --------------------------------------------------------------------------- #
def send_to_school(db: Session, user: User, request_id: int) -> Request:
    """Send a paid BOOK request to the school (SENT_TO_SCHOOL)."""
    request = request_service.get_request(db, user, request_id)
    new_status = _plan(user, request, WorkflowAction.SEND_TO_SCHOOL)
    _commit_transition(
        db, user, request, WorkflowAction.SEND_TO_SCHOOL, new_status
    )
    return _finish(db, request)


def move_to_store(db: Session, user: User, request_id: int) -> Request:
    """Move a paid OTHER request into the store (IN_STORE).

    Each request line is added to the branch's stock as an IN movement,
    referenced to the request.
    """
    request = request_service.get_request(db, user, request_id)
    new_status = _plan(user, request, WorkflowAction.MOVE_TO_STORE)

    for line in request.lines:
        inventory_service.add_stock(
            db,
            user=user,
            branch_id=request.branch_id,
            item_name=line.description,
            quantity=line.quantity,
            reference_id=request.id,
        )

    _commit_transition(
        db, user, request, WorkflowAction.MOVE_TO_STORE, new_status
    )
    return _finish(db, request)
