"""Tests for the procurement workflow (Phase 4)."""

from __future__ import annotations

from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.audit import AuditLog
from app.models.branch import Branch, BranchType
from app.models.procurement import (
    Delivery,
    Payment,
    PurchaseOrder,
    Requisition,
    Verification,
)
from app.models.request import Request, RequestStatus
from app.models.user import CENTRAL_ROLES, Role


def _make_branch(db: Session, name: str) -> Branch:
    """Create and persist a primary branch."""
    branch = Branch(name=name, type=BranchType.PRIMARY)
    db.add(branch)
    db.commit()
    db.refresh(branch)
    return branch


def _cast(
    db: Session, make_user, auth_headers, branch_name: str = "Primary A"
) -> tuple[Branch, dict[str, dict[str, str]]]:
    """Create one branch and a user for every role used by procurement.

    Returns the branch and a mapping of short name -> auth headers.
    """
    branch = _make_branch(db, branch_name)
    specs: dict[str, list[Role]] = {
        "staff": [Role.REQUESTING_STAFF],
        "staff2": [Role.REQUESTING_STAFF],
        "academic": [Role.ACADEMIC_MASTER],
        "head": [Role.HEAD_MASTER],
        "librarian": [Role.LIBRARIAN],
        "bursar": [Role.BURSAR],
        "manager": [Role.MANAGER],
        "store": [Role.STOREKEEPER],
        "admin": [Role.ADMIN],
    }
    headers: dict[str, dict[str, str]] = {}
    slug = branch_name.replace(" ", "").lower()
    for name, roles in specs.items():
        branch_ids = [None] if roles[0] in CENTRAL_ROLES else [branch.id]
        email = f"{name}.{slug}@example.com"
        make_user(email=email, roles=roles, branch_ids=branch_ids)
        headers[name] = auth_headers(email)
    return branch, headers


def _register_supplier(
    client: TestClient, headers: dict[str, str], name: str = "Acme Ltd"
) -> int:
    """Register a supplier and return its id."""
    response = client.post(
        "/suppliers",
        headers=headers,
        json={"name": name, "contact_person": "Jo", "phone": "0700"},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _create(
    client: TestClient, headers: dict[str, str], request_type: str = "BOOK"
) -> int:
    """Create a request as the requesting staff member."""
    response = client.post(
        "/requests",
        headers=headers,
        json={"type": request_type, "title": "Supply request"},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _post(
    client: TestClient,
    headers: dict[str, str],
    request_id: int,
    step: str,
    json: dict | None = None,
    expected: str | None = None,
) -> dict:
    """POST a procurement step and assert the resulting request status."""
    response = client.post(
        f"/requests/{request_id}/{step}", headers=headers, json=json or {}
    )
    assert response.status_code == 200, response.text
    body = response.json()
    if expected is not None:
        assert body["status"] == expected, body
    return body


def _book_to_approved(
    client: TestClient, headers: dict[str, dict[str, str]]
) -> int:
    """Drive a BOOK request from creation to APPROVED."""
    request_id = _create(client, headers["staff"], "BOOK")
    _post(
        client,
        headers["academic"],
        request_id,
        "approve",
        expected="PENDING_HEAD_MASTER",
    )
    _post(client, headers["head"], request_id, "approve", expected="APPROVED")
    return request_id


def _book_to_received(
    client: TestClient, headers: dict[str, dict[str, str]], supplier_id: int
) -> int:
    """Drive a BOOK request to RECEIVED (delivery awaiting verification)."""
    request_id = _book_to_approved(client, headers)
    _post(
        client,
        headers["librarian"],
        request_id,
        "requisition",
        {"notes": "Order these books"},
        expected="PENDING_BURSAR",
    )
    _post(
        client,
        headers["bursar"],
        request_id,
        "purchase-order",
        {"supplier_id": supplier_id, "total_amount": "1500.00"},
        expected="PENDING_MANAGER",
    )
    _post(
        client,
        headers["manager"],
        request_id,
        "manager-approval",
        {"approve": True, "comment": "Approved"},
        expected="PENDING_ORDER",
    )
    _post(client, headers["store"], request_id, "order", expected="ORDERED")
    _post(
        client,
        headers["store"],
        request_id,
        "receive",
        {"delivery_note": "5 boxes"},
        expected="RECEIVED",
    )
    return request_id


# --------------------------------------------------------------------------- #
# Suppliers
# --------------------------------------------------------------------------- #
def test_bursar_creates_and_lists_supplier(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """A BURSAR can register a supplier and see it listed."""
    _, headers = _cast(db_session, make_user, auth_headers)
    supplier_id = _register_supplier(client, headers["bursar"], "Books R Us")

    listed = client.get("/suppliers", headers=headers["bursar"])
    assert listed.status_code == 200
    assert [s["id"] for s in listed.json()] == [supplier_id]


def test_supplier_requires_admin_or_bursar(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """Other roles cannot create or list suppliers."""
    _, headers = _cast(db_session, make_user, auth_headers)
    assert (
        client.post(
            "/suppliers", headers=headers["store"], json={"name": "Nope"}
        ).status_code
        == 403
    )
    assert client.get("/suppliers", headers=headers["staff"]).status_code == 403


def test_duplicate_supplier_conflict(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """Registering the same supplier name twice returns 409."""
    _, headers = _cast(db_session, make_user, auth_headers)
    _register_supplier(client, headers["admin"], "Acme Ltd")
    response = client.post(
        "/suppliers", headers=headers["admin"], json={"name": "Acme Ltd"}
    )
    assert response.status_code == 409


# --------------------------------------------------------------------------- #
# Full flows
# --------------------------------------------------------------------------- #
def test_full_book_flow_to_sent_to_school(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """A BOOK request runs from PENDING_ACADEMIC through to SENT_TO_SCHOOL."""
    _, headers = _cast(db_session, make_user, auth_headers)
    supplier_id = _register_supplier(client, headers["bursar"])

    request_id = _create(client, headers["staff"], "BOOK")
    assert (
        client.get(f"/requests/{request_id}", headers=headers["store"]).json()[
            "status"
        ]
        == "PENDING_ACADEMIC"
    )

    _post(
        client,
        headers["academic"],
        request_id,
        "approve",
        expected="PENDING_HEAD_MASTER",
    )
    _post(client, headers["head"], request_id, "approve", expected="APPROVED")
    _post(
        client,
        headers["librarian"],
        request_id,
        "requisition",
        expected="PENDING_BURSAR",
    )
    _post(
        client,
        headers["bursar"],
        request_id,
        "purchase-order",
        {"supplier_id": supplier_id, "total_amount": "1500.00"},
        expected="PENDING_MANAGER",
    )
    _post(
        client,
        headers["manager"],
        request_id,
        "manager-approval",
        {"approve": True},
        expected="PENDING_ORDER",
    )
    _post(client, headers["store"], request_id, "order", expected="ORDERED")
    _post(client, headers["store"], request_id, "receive", expected="RECEIVED")
    _post(
        client,
        headers["staff"],
        request_id,
        "verify",
        {"matched": True, "note": "All present"},
        expected="VERIFIED",
    )
    _post(client, headers["bursar"], request_id, "pay", expected="PAID")
    final = _post(
        client, headers["store"], request_id, "send-to-school",
        expected="SENT_TO_SCHOOL",
    )
    assert final["status"] == "SENT_TO_SCHOOL"

    assert db_session.scalar(
        select(Requisition).where(Requisition.request_id == request_id)
    )
    assert db_session.scalar(
        select(PurchaseOrder).where(PurchaseOrder.request_id == request_id)
    )
    assert db_session.scalar(
        select(Delivery).where(Delivery.request_id == request_id)
    )
    assert db_session.scalar(
        select(Verification).where(Verification.request_id == request_id)
    )
    assert db_session.scalar(
        select(Payment).where(Payment.request_id == request_id)
    )


def test_full_other_flow_to_in_store(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """An OTHER request runs through the BURSAR/MANAGER steps to IN_STORE."""
    _, headers = _cast(db_session, make_user, auth_headers)
    supplier_id = _register_supplier(client, headers["bursar"])

    request_id = _create(client, headers["staff"], "OTHER")
    # School approval moves OTHER to APPROVED, awaiting the librarian.
    _post(
        client,
        headers["head"],
        request_id,
        "approve",
        expected="APPROVED",
    )
    _post(
        client,
        headers["librarian"],
        request_id,
        "requisition",
        {},
        expected="PENDING_BURSAR",
    )
    _post(
        client,
        headers["bursar"],
        request_id,
        "purchase-order",
        {"supplier_id": supplier_id, "total_amount": "300.50"},
        expected="PENDING_MANAGER",
    )
    _post(
        client,
        headers["manager"],
        request_id,
        "manager-approval",
        {"approve": True},
        expected="PENDING_ORDER",
    )
    _post(client, headers["store"], request_id, "order", expected="ORDERED")
    _post(client, headers["store"], request_id, "receive", expected="RECEIVED")
    _post(
        client,
        headers["staff"],
        request_id,
        "verify",
        {"matched": True},
        expected="VERIFIED",
    )
    _post(client, headers["bursar"], request_id, "pay", expected="PAID")
    _post(
        client,
        headers["librarian"],
        request_id,
        "move-to-store",
        expected="IN_STORE",
    )

    stored = db_session.get(Request, request_id)
    assert stored is not None
    assert stored.status == RequestStatus.IN_STORE


def test_other_request_requisition_requires_approval(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """An OTHER requisition is only valid once the request is APPROVED."""
    _, headers = _cast(db_session, make_user, auth_headers)
    request_id = _create(client, headers["staff"], "OTHER")
    response = client.post(
        f"/requests/{request_id}/requisition", headers=headers["librarian"]
    )
    assert response.status_code == 409


def test_other_request_requisition_by_librarian(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """A Librarian forwards an approved OTHER request to the Bursar."""
    _, headers = _cast(db_session, make_user, auth_headers)
    request_id = _create(client, headers["staff"], "OTHER")
    _post(client, headers["academic"], request_id, "approve", expected="APPROVED")
    _post(
        client,
        headers["librarian"],
        request_id,
        "requisition",
        {},
        expected="PENDING_BURSAR",
    )


# --------------------------------------------------------------------------- #
# DISPUTED path
# --------------------------------------------------------------------------- #
def test_disputed_path(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """A failed verification moves the request to DISPUTED and blocks payment."""
    _, headers = _cast(db_session, make_user, auth_headers)
    supplier_id = _register_supplier(client, headers["bursar"])

    request_id = _book_to_received(client, headers, supplier_id)

    body = _post(
        client,
        headers["staff"],
        request_id,
        "verify",
        {"matched": False, "note": "Two books missing"},
        expected="DISPUTED",
    )
    assert body["status"] == "DISPUTED"

    # Payment is blocked while the request is DISPUTED (never VERIFIED).
    blocked = client.post(
        f"/requests/{request_id}/pay", headers=headers["bursar"]
    )
    assert blocked.status_code == 409


# --------------------------------------------------------------------------- #
# Business-rule enforcement
# --------------------------------------------------------------------------- #
def test_payment_before_verification_blocked(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """Payment is only possible once the request is VERIFIED."""
    _, headers = _cast(db_session, make_user, auth_headers)
    supplier_id = _register_supplier(client, headers["bursar"])

    request_id = _book_to_received(client, headers, supplier_id)
    response = client.post(
        f"/requests/{request_id}/pay", headers=headers["bursar"]
    )
    assert response.status_code == 409
    assert db_session.scalar(
        select(Payment).where(Payment.request_id == request_id)
    ) is None


def test_non_requestor_verify_blocked(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """Another user with the same role cannot verify someone else's request."""
    _, headers = _cast(db_session, make_user, auth_headers)
    supplier_id = _register_supplier(client, headers["bursar"])

    request_id = _book_to_received(client, headers, supplier_id)

    # staff2 holds the same REQUESTING_STAFF role but is not the requestor.
    blocked = client.post(
        f"/requests/{request_id}/verify",
        headers=headers["staff2"],
        json={"matched": True},
    )
    assert blocked.status_code == 403

    stored = db_session.get(Request, request_id)
    assert stored is not None
    assert stored.status == RequestStatus.RECEIVED


def test_wrong_role_receive_blocked(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """Only the Storekeeper may receive a delivery."""
    _, headers = _cast(db_session, make_user, auth_headers)
    supplier_id = _register_supplier(client, headers["bursar"])

    request_id = _book_to_approved(client, headers)
    _post(
        client,
        headers["librarian"],
        request_id,
        "requisition",
        expected="PENDING_BURSAR",
    )
    _post(
        client,
        headers["bursar"],
        request_id,
        "purchase-order",
        {"supplier_id": supplier_id, "total_amount": "100.00"},
        expected="PENDING_MANAGER",
    )
    _post(
        client,
        headers["manager"],
        request_id,
        "manager-approval",
        {"approve": True},
        expected="PENDING_ORDER",
    )
    _post(client, headers["store"], request_id, "order", expected="ORDERED")

    # The Bursar has a valid step available but the wrong role.
    response = client.post(
        f"/requests/{request_id}/receive", headers=headers["bursar"]
    )
    assert response.status_code == 403
    assert db_session.scalar(
        select(Delivery).where(Delivery.request_id == request_id)
    ) is None


def test_skipped_step_blocked(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """A step cannot be skipped even with the correct role."""
    _, headers = _cast(db_session, make_user, auth_headers)
    supplier_id = _register_supplier(client, headers["bursar"])

    # ORDER is a Storekeeper step, but the request is still at PENDING_ACADEMIC.
    request_id = _create(client, headers["staff"], "BOOK")
    response = client.post(
        f"/requests/{request_id}/order", headers=headers["store"]
    )
    assert response.status_code == 409

    # Likewise, receiving before ordering is blocked.
    request_id = _book_to_approved(client, headers)
    _post(client, headers["librarian"], request_id, "requisition")
    _post(
        client,
        headers["bursar"],
        request_id,
        "purchase-order",
        {"supplier_id": supplier_id, "total_amount": "100.00"},
    )
    _post(
        client,
        headers["manager"],
        request_id,
        "manager-approval",
        {"approve": True},
    )
    # At PENDING_ORDER, receiving (a RECEIVED-only edge) is invalid.
    response = client.post(
        f"/requests/{request_id}/receive", headers=headers["store"]
    )
    assert response.status_code == 409


def test_school_role_cannot_act_on_other_branch(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """A Librarian in another branch cannot requisition a foreign request."""
    branch_a, headers_a = _cast(db_session, make_user, auth_headers, "Primary A")
    _, headers_b = _cast(db_session, make_user, auth_headers, "Primary B")

    request_id = _book_to_approved(client, headers_a)
    response = client.post(
        f"/requests/{request_id}/requisition", headers=headers_b["librarian"]
    )
    assert response.status_code == 404


def test_manager_can_reject(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """The Manager can reject at PENDING_MANAGER, ending the flow."""
    _, headers = _cast(db_session, make_user, auth_headers)
    supplier_id = _register_supplier(client, headers["bursar"])

    request_id = _book_to_approved(client, headers)
    _post(client, headers["librarian"], request_id, "requisition")
    _post(
        client,
        headers["bursar"],
        request_id,
        "purchase-order",
        {
            "supplier_id": supplier_id,
            "total_amount": "250.00",
        },
    )
    _post(
        client,
        headers["manager"],
        request_id,
        "manager-approval",
        {"approve": False, "comment": "Too expensive"},
        expected="REJECTED",
    )


# --------------------------------------------------------------------------- #
# Audit trail
# --------------------------------------------------------------------------- #
def test_audit_row_written_at_every_step(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """Every procurement transition appends exactly one audit row."""
    _, headers = _cast(db_session, make_user, auth_headers)
    supplier_id = _register_supplier(client, headers["bursar"])

    request_id = _book_to_received(client, headers, supplier_id)
    _post(
        client,
        headers["staff"],
        request_id,
        "verify",
        {"matched": True},
    )
    _post(client, headers["bursar"], request_id, "pay")
    _post(client, headers["store"], request_id, "send-to-school")

    rows = list(
        db_session.scalars(
            select(AuditLog)
            .where(AuditLog.request_id == request_id)
            .order_by(AuditLog.id)
        ).all()
    )
    assert [row.action for row in rows] == [
        "CREATE",
        "APPROVE",
        "APPROVE",
        "REQUISITION",
        "PURCHASE_ORDER",
        "APPROVE",
        "ORDER",
        "RECEIVE",
        "VERIFY_TRUE",
        "PAY",
        "SEND_TO_SCHOOL",
    ]
    # Statuses chain cleanly from the initial state to the terminal state.
    assert rows[0].from_status is None
    assert rows[0].to_status == "PENDING_ACADEMIC"
    assert rows[-1].to_status == "SENT_TO_SCHOOL"
    for previous, current in zip(rows, rows[1:]):
        assert previous.to_status == current.from_status


def test_disputed_writes_audit_row(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """A failed verification is audited as VERIFY_FALSE -> DISPUTED."""
    _, headers = _cast(db_session, make_user, auth_headers)
    supplier_id = _register_supplier(client, headers["bursar"])

    request_id = _book_to_received(client, headers, supplier_id)
    _post(
        client,
        headers["staff"],
        request_id,
        "verify",
        {"matched": False, "note": "Damaged"},
    )

    last = db_session.scalars(
        select(AuditLog)
        .where(AuditLog.request_id == request_id)
        .order_by(AuditLog.id.desc())
    ).first()
    assert last is not None
    assert last.action == "VERIFY_FALSE"
    assert last.from_status == "RECEIVED"
    assert last.to_status == "DISPUTED"
    assert last.detail == "Damaged"


def test_payment_uses_purchase_order_total(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """Omitting the amount defaults the payment to the purchase-order total."""
    _, headers = _cast(db_session, make_user, auth_headers)
    supplier_id = _register_supplier(client, headers["bursar"])

    request_id = _book_to_received(client, headers, supplier_id)
    _post(client, headers["staff"], request_id, "verify", {"matched": True})
    _post(client, headers["bursar"], request_id, "pay")

    payment = db_session.scalar(
        select(Payment).where(Payment.request_id == request_id)
    )
    assert payment is not None
    assert payment.amount == Decimal("1500.00")
