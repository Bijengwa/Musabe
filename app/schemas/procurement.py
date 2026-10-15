"""Pydantic schemas for the procurement pipeline.

Each schema maps to one request-workflow step: requisition, purchase order,
manager decision, delivery, verification, and payment.
"""

from __future__ import annotations

from datetime import datetime
from decimal import Decimal

from pydantic import BaseModel, ConfigDict, Field


class RequisitionCreate(BaseModel):
    """Payload for raising a requisition (BOOK requests)."""

    notes: str | None = None


class PurchaseOrderCreate(BaseModel):
    """Payload for creating a purchase order with a supplier and total."""

    supplier_id: int
    total_amount: Decimal = Field(gt=0)


class ManagerDecision(BaseModel):
    """Payload for the Manager's approve/reject decision."""

    approve: bool
    comment: str | None = None


class DeliveryCreate(BaseModel):
    """Payload for receiving a delivery."""

    delivery_note: str | None = None


class VerificationCreate(BaseModel):
    """Payload for verifying a delivery against the request."""

    matched: bool
    note: str | None = None


class PaymentCreate(BaseModel):
    """Payload for recording a payment.

    ``amount`` defaults to the linked purchase order's total when omitted.
    """

    amount: Decimal | None = Field(default=None, gt=0)
    reference: str | None = None


class RequisitionRead(BaseModel):
    """A requisition returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    request_id: int
    created_by_id: int
    notes: str | None
    created_at: datetime


class PurchaseOrderRead(BaseModel):
    """A purchase order returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    request_id: int
    supplier_id: int
    created_by_id: int
    po_number: str
    total_amount: Decimal
    created_at: datetime


class DeliveryRead(BaseModel):
    """A delivery returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    request_id: int
    received_by_id: int
    delivery_note: str | None
    created_at: datetime


class VerificationRead(BaseModel):
    """A verification returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    request_id: int
    verified_by_id: int
    matched: bool
    note: str | None
    created_at: datetime


class PaymentRead(BaseModel):
    """A payment returned by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    request_id: int
    paid_by_id: int
    amount: Decimal
    reference: str | None
    created_at: datetime
