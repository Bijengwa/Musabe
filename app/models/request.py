"""Request, request line, and approval models.

A request is raised by one requestor against one branch. Books and other
items follow different approval workflows (see ``app.services.workflow``).
"""

from __future__ import annotations

import enum
from datetime import datetime, timezone
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.database import Base

if TYPE_CHECKING:
    from app.models.branch import Branch
    from app.models.user import User


class RequestType(str, enum.Enum):
    """Kind of request, which selects the approval workflow."""

    BOOK = "BOOK"
    OTHER = "OTHER"


class RequestStatus(str, enum.Enum):
    """Lifecycle status of a request.

    Approval statuses:

    * ``PENDING_ACADEMIC``/``PENDING_HEAD_MASTER`` (BOOK flow)
    * ``PENDING_APPROVAL`` (OTHER flow)
    * ``APPROVED`` (after school approval, before the librarian requisition)

    Procurement statuses (shared by both flows unless noted):

    * ``PENDING_BURSAR`` / ``PENDING_MANAGER`` / ``PENDING_ORDER``
    * ``ORDERED`` / ``RECEIVED`` / ``VERIFIED`` / ``DISPUTED`` / ``PAID``
    * ``SENT_TO_SCHOOL`` (BOOK only, after payment)
    * ``CATALOGUED`` (BOOK only, after library catalogue entry)
    * ``IN_STORE`` (OTHER, terminal)

    ``REJECTED`` is a terminal state for either flow.
    """

    PENDING_ACADEMIC = "PENDING_ACADEMIC"
    PENDING_HEAD_MASTER = "PENDING_HEAD_MASTER"
    PENDING_APPROVAL = "PENDING_APPROVAL"
    APPROVED = "APPROVED"
    PENDING_BURSAR = "PENDING_BURSAR"
    PENDING_MANAGER = "PENDING_MANAGER"
    PENDING_ORDER = "PENDING_ORDER"
    ORDERED = "ORDERED"
    RECEIVED = "RECEIVED"
    VERIFIED = "VERIFIED"
    DISPUTED = "DISPUTED"
    PAID = "PAID"
    SENT_TO_SCHOOL = "SENT_TO_SCHOOL"
    CATALOGUED = "CATALOGUED"
    IN_STORE = "IN_STORE"
    REJECTED = "REJECTED"


class ApprovalAction(str, enum.Enum):
    """Decision recorded against a request by an approver."""

    APPROVE = "APPROVE"
    REJECT = "REJECT"


def _utcnow() -> datetime:
    """Return the current UTC time (portable across databases)."""
    return datetime.now(timezone.utc)


class Request(Base):
    """A request for books or other items raised by a staff member."""

    __tablename__ = "requests"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    type: Mapped[RequestType] = mapped_column(
        Enum(RequestType, native_enum=False, length=16), nullable=False
    )
    status: Mapped[RequestStatus] = mapped_column(
        Enum(RequestStatus, native_enum=False, length=32),
        nullable=False,
        index=True,
    )
    branch_id: Mapped[int] = mapped_column(
        ForeignKey("branches.id"), nullable=False, index=True
    )
    requestor_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"), nullable=False, index=True
    )
    title: Mapped[str | None] = mapped_column(String(200), nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=_utcnow, nullable=False
    )

    branch: Mapped["Branch"] = relationship()
    requestor: Mapped["User"] = relationship()
    lines: Mapped[list["RequestLine"]] = relationship(
        back_populates="request",
        cascade="all, delete-orphan",
    )
    approvals: Mapped[list["Approval"]] = relationship(
        back_populates="request",
        cascade="all, delete-orphan",
        order_by="Approval.id",
    )


class RequestLine(Base):
    """A single item requested within a :class:`Request`."""

    __tablename__ = "request_lines"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    request_id: Mapped[int] = mapped_column(
        ForeignKey("requests.id", ondelete="CASCADE"), nullable=False, index=True
    )
    description: Mapped[str] = mapped_column(String(255), nullable=False)
    quantity: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    unit: Mapped[str | None] = mapped_column(String(50), nullable=True)

    request: Mapped["Request"] = relationship(back_populates="lines")


class Approval(Base):
    """A recorded approve/reject decision on a request."""

    __tablename__ = "approvals"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    request_id: Mapped[int] = mapped_column(
        ForeignKey("requests.id", ondelete="CASCADE"), nullable=False, index=True
    )
    approver_id: Mapped[int] = mapped_column(
        ForeignKey("users.id"), nullable=False, index=True
    )
    action: Mapped[ApprovalAction] = mapped_column(
        Enum(ApprovalAction, native_enum=False, length=16), nullable=False
    )
    from_status: Mapped[RequestStatus] = mapped_column(
        Enum(RequestStatus, native_enum=False, length=32), nullable=False
    )
    to_status: Mapped[RequestStatus] = mapped_column(
        Enum(RequestStatus, native_enum=False, length=32), nullable=False
    )
    comment: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=_utcnow, nullable=False
    )

    request: Mapped["Request"] = relationship(back_populates="approvals")
    approver: Mapped["User"] = relationship()
