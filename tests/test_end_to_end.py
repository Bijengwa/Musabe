"""End-to-end tests that drive requests through the whole pipeline (Phase 7)."""

from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.audit import AuditLog
from app.models.branch import Branch, BranchType
from app.models.inventory import StockMovement, StockMovementType
from app.models.library import BookCopy, BookCopyStatus
from app.models.request import Request, RequestStatus
from app.models.user import CENTRAL_ROLES, Role


def _make_branch(
    db: Session, name: str, branch_type: BranchType = BranchType.PRIMARY
) -> Branch:
    branch = Branch(name=name, type=branch_type)
    db.add(branch)
    db.commit()
    db.refresh(branch)
    return branch


def _cast(
    db: Session, make_user, auth_headers, branch_name: str = "Primary A"
) -> tuple[Branch, dict[str, dict[str, str]]]:
    branch = _make_branch(db, branch_name)
    specs: dict[str, list[Role]] = {
        "staff": [Role.REQUESTING_STAFF],
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


def _make_supplier(client: TestClient, headers: dict[str, str]) -> int:
    response = client.post(
        "/suppliers", headers=headers, json={"name": "E2E Supplier"}
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def test_book_flow_end_to_end(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """A BOOK request reaches CATALOGUED, then a copy is issued and returned."""
    branch, h = _cast(db_session, make_user, auth_headers)
    supplier_id = _make_supplier(client, h["bursar"])

    request_id = client.post(
        "/requests",
        headers=h["staff"],
        json={
            "type": "BOOK",
            "title": "Physics",
            "lines": [{"description": "Physics textbook", "quantity": 3}],
        },
    ).json()["id"]

    steps = [
        (f"/requests/{request_id}/approve", h["academic"], {}),
        (f"/requests/{request_id}/approve", h["head"], {}),
        (f"/requests/{request_id}/requisition", h["librarian"], {}),
        (
            f"/requests/{request_id}/purchase-order",
            h["bursar"],
            {"supplier_id": supplier_id, "total_amount": "300000.00"},
        ),
        (
            f"/requests/{request_id}/manager-approval",
            h["manager"],
            {"approve": True},
        ),
        (f"/requests/{request_id}/order", h["store"], {}),
        (f"/requests/{request_id}/receive", h["store"], {}),
        (f"/requests/{request_id}/verify", h["staff"], {"matched": True}),
        (f"/requests/{request_id}/pay", h["bursar"], {}),
        (f"/requests/{request_id}/send-to-school", h["store"], {}),
    ]
    for url, headers, payload in steps:
        response = client.post(url, headers=headers, json=payload)
        assert response.status_code == 200, (url, response.text)

    catalogued = client.post(
        "/library/catalogue", headers=h["librarian"], json={"request_id": request_id}
    )
    assert catalogued.status_code == 200, catalogued.text
    assert catalogued.json()["status"] == "CATALOGUED"

    request = db_session.get(Request, request_id)
    assert request.status == RequestStatus.CATALOGUED

    copies = list(
        db_session.scalars(
            select(BookCopy).where(BookCopy.request_id == request_id)
        ).all()
    )
    assert len(copies) == 3
    assert all(c.status is BookCopyStatus.AVAILABLE for c in copies)

    issue = client.post(
        "/issues",
        headers=h["librarian"],
        json={"borrower": "Student One", "book_code": copies[0].code},
    )
    assert issue.status_code == 201, issue.text
    assert issue.json()["status"] == "ISSUED"

    returned = client.post(
        f"/issues/{issue.json()['id']}/return", headers=h["librarian"]
    )
    assert returned.status_code == 200
    assert returned.json()["status"] == "RETURNED"

    db_session.refresh(copies[0])
    assert copies[0].status is BookCopyStatus.AVAILABLE

    actions = {
        row.action
        for row in db_session.scalars(select(AuditLog)).all()
    }
    assert {"APPROVE", "REQUISITION", "PURCHASE_ORDER", "CATALOGUE", "ISSUE"} <= actions


def test_other_flow_end_to_end(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """An OTHER request reaches IN_STORE and creates matching stock."""
    branch, h = _cast(db_session, make_user, auth_headers)
    supplier_id = _make_supplier(client, h["bursar"])

    request_id = client.post(
        "/requests",
        headers=h["staff"],
        json={
            "type": "OTHER",
            "title": "Sanitary",
            "lines": [{"description": "Bar soap", "quantity": 12}],
        },
    ).json()["id"]

    steps = [
        (f"/requests/{request_id}/approve", h["head"], {}),
        (
            f"/requests/{request_id}/purchase-order",
            h["bursar"],
            {"supplier_id": supplier_id, "total_amount": "50000.00"},
        ),
        (f"/requests/{request_id}/manager-approval", h["manager"], {"approve": True}),
        (f"/requests/{request_id}/order", h["store"], {}),
        (f"/requests/{request_id}/receive", h["store"], {}),
        (f"/requests/{request_id}/verify", h["staff"], {"matched": True}),
        (f"/requests/{request_id}/pay", h["bursar"], {}),
        (f"/requests/{request_id}/move-to-store", h["librarian"], {}),
    ]
    for url, headers, payload in steps:
        response = client.post(url, headers=headers, json=payload)
        assert response.status_code == 200, (url, response.text)

    request = db_session.get(Request, request_id)
    assert request.status is RequestStatus.IN_STORE

    movements = list(
        db_session.scalars(
            select(StockMovement).where(
                StockMovement.reference_id == request_id,
                StockMovement.movement_type == StockMovementType.IN,
            )
        ).all()
    )
    assert any(m.quantity == 12 for m in movements)


def test_disputed_flow(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """A failed verification moves the request to DISPUTED."""
    branch, h = _cast(db_session, make_user, auth_headers)
    supplier_id = _make_supplier(client, h["bursar"])

    request_id = client.post(
        "/requests",
        headers=h["staff"],
        json={"type": "OTHER", "lines": [{"description": "Brooms", "quantity": 5}]},
    ).json()["id"]

    steps = [
        (f"/requests/{request_id}/approve", h["head"], {}),
        (
            f"/requests/{request_id}/purchase-order",
            h["bursar"],
            {"supplier_id": supplier_id, "total_amount": "10000.00"},
        ),
        (f"/requests/{request_id}/manager-approval", h["manager"], {"approve": True}),
        (f"/requests/{request_id}/order", h["store"], {}),
        (f"/requests/{request_id}/receive", h["store"], {}),
    ]
    for url, headers, payload in steps:
        response = client.post(url, headers=headers, json=payload)
        assert response.status_code == 200, (url, response.text)

    disputed = client.post(
        f"/requests/{request_id}/verify",
        headers=h["staff"],
        json={"matched": False, "note": "Only 3 of 5 delivered"},
    )
    assert disputed.status_code == 200, disputed.text

    request = db_session.get(Request, request_id)
    assert request.status is RequestStatus.DISPUTED
