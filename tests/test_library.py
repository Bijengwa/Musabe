"""Tests for the library catalogue (Phase 5)."""

from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.audit import AuditLog
from app.models.branch import Branch, BranchType
from app.models.library import BookCopy, BookCopyStatus
from app.models.user import CENTRAL_ROLES, Role, User, RoleAssignment
from app.models.inventory import StockItem, StockMovement, StockMovementType
from app.services import inventory_service
from app.utils import codes
from fastapi import HTTPException


def _make_branch(db: Session, name: str) -> Branch:
    branch = Branch(name=name, type=BranchType.PRIMARY)
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
    response = client.post(
        "/suppliers",
        headers=headers,
        json={"name": name, "contact_person": "Jo", "phone": "0700"},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _create_book_request(
    client: TestClient, headers: dict[str, str], title: str, quantity: int = 3
) -> int:
    response = client.post(
        "/requests",
        headers=headers,
        json={
            "type": "BOOK",
            "title": title,
            "lines": [{"description": title, "quantity": quantity}],
        },
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
    response = client.post(
        f"/requests/{request_id}/{step}", headers=headers, json=json or {}
    )
    assert response.status_code == 200, response.text
    body = response.json()
    if expected is not None:
        assert body["status"] == expected, body
    return body


def _book_to_sent_to_school(
    client: TestClient, headers: dict[str, dict[str, str]], supplier_id: int
) -> int:
    request_id = _create_book_request(client, headers["staff"], "New Readers", quantity=2)
    _post(client, headers["academic"], request_id, "approve", expected="PENDING_HEAD_MASTER")
    _post(client, headers["head"], request_id, "approve", expected="APPROVED")
    _post(client, headers["librarian"], request_id, "requisition", expected="PENDING_BURSAR")
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
    _post(client, headers["staff"], request_id, "verify", {"matched": True}, expected="VERIFIED")
    _post(client, headers["bursar"], request_id, "pay", expected="PAID")
    _post(client, headers["store"], request_id, "send-to-school", expected="SENT_TO_SCHOOL")
    return request_id


def _create_other_request(
    client: TestClient, headers: dict[str, str], title: str = "Staples"
) -> int:
    response = client.post(
        "/requests",
        headers=headers,
        json={"type": "OTHER", "title": title, "lines": [{"description": "Staples", "quantity": 10}]},
    )
    assert response.status_code == 201, response.text
    return response.json()["id"]


def _book_to_approved(
    client: TestClient, headers: dict[str, dict[str, str]]
) -> int:
    request_id = _create_book_request(client, headers["staff"], "Maths", quantity=5)
    _post(client, headers["academic"], request_id, "approve", expected="PENDING_HEAD_MASTER")
    _post(client, headers["head"], request_id, "approve", expected="APPROVED")
    return request_id

def test_catalogue_creates_copies_and_audit(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    _, headers = _cast(db_session, make_user, auth_headers)
    supplier_id = _register_supplier(client, headers["bursar"])
    request_id = _book_to_sent_to_school(client, headers, supplier_id)

    response = client.post(
        "/library/catalogue",
        headers=headers["librarian"],
        json={"request_id": request_id},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "CATALOGUED"
    assert body["id"] == request_id

    copies = list(
        db_session.scalars(select(BookCopy).where(BookCopy.request_id == request_id)).all()
    )
    assert len(copies) == 2
    codes = {copy.code for copy in copies}
    assert len(codes) == 2
    for code in codes:
        assert code.startswith("MUS-PA-")
    for copy in copies:
        assert copy.status == BookCopyStatus.AVAILABLE
        assert copy.branch_id == body["branch_id"]

    last_audit = db_session.scalars(
        select(AuditLog)
        .where(AuditLog.request_id == request_id)
        .order_by(AuditLog.id.desc())
    ).first()
    assert last_audit is not None
    assert last_audit.action == "CATALOGUE"


def test_list_and_get_books(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    _, headers = _cast(db_session, make_user, auth_headers)
    supplier_id = _register_supplier(client, headers["bursar"])
    request_id = _book_to_sent_to_school(client, headers, supplier_id)

    client.post(
        "/library/catalogue",
        headers=headers["librarian"],
        json={"request_id": request_id},
    )

    listed = client.get("/library/books", headers=headers["librarian"])
    assert listed.status_code == 200
    data = listed.json()
    assert len(data) == 2
    code = data[0]["code"]

    fetched = client.get(f"/library/books/{code}", headers=headers["librarian"])
    assert fetched.status_code == 200
    assert fetched.json()["code"] == code


def test_catalogue_rejects_non_book(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    _, headers = _cast(db_session, make_user, auth_headers)
    supplier_id = _register_supplier(client, headers["bursar"])

    request_id = client.post(
        "/requests",
        headers=headers["staff"],
        json={"type": "OTHER", "title": "Staples"},
    ).json()["id"]
    client.post(f"/requests/{request_id}/approve", headers=headers["head"])

    response = client.post(
        "/library/catalogue",
        headers=headers["librarian"],
        json={"request_id": request_id},
    )
    assert response.status_code == 400

def test_catalogue_creates_right_number_and_unique_codes(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    _, headers = _cast(db_session, make_user, auth_headers)
    supplier_id = _register_supplier(client, headers["bursar"])
    request_id = _book_to_sent_to_school(client, headers, supplier_id)
    client.post("/library/catalogue", headers=headers["librarian"], json={"request_id": request_id})
    copies = list(db_session.scalars(select(BookCopy).where(BookCopy.request_id == request_id)).all())
    assert len(copies) == 2
    codes = {c.code for c in copies}
    assert len(codes) == len(copies)
    for c in codes:
        assert c.startswith("MUS-PA-")


def test_catalogue_blocked_if_not_sent_to_school(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    _, headers = _cast(db_session, make_user, auth_headers)
    request_id = _book_to_approved(client, headers)
    resp = client.post("/library/catalogue", headers=headers["librarian"], json={"request_id": request_id})
    assert resp.status_code == 409


def test_catalogue_blocked_for_non_librarian(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    _, headers = _cast(db_session, make_user, auth_headers)
    supplier_id = _register_supplier(client, headers["bursar"])
    request_id = _book_to_sent_to_school(client, headers, supplier_id)
    resp = client.post("/library/catalogue", headers=headers["store"], json={"request_id": request_id})
    assert resp.status_code == 403


def test_catalogue_blocked_for_librarian_other_branch(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    branch_a, headers_a = _cast(db_session, make_user, auth_headers, "Primary A")
    _, headers_b = _cast(db_session, make_user, auth_headers, "Primary B")
    supplier_id = _register_supplier(client, headers_a["bursar"])
    request_id = _book_to_sent_to_school(client, headers_a, supplier_id)
    resp = client.post("/library/catalogue", headers=headers_b["librarian"], json={"request_id": request_id})
    assert resp.status_code == 404


def test_move_to_store_increases_stock_and_writes_in_movements(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    _, headers = _cast(db_session, make_user, auth_headers)
    supplier_id = _register_supplier(client, headers["bursar"])
    request_id = _create_other_request(client, headers["staff"], "Staples")
    _post(client, headers["head"], request_id, "approve", expected="PENDING_BURSAR")
    _post(client, headers["bursar"], request_id, "purchase-order", {"supplier_id": supplier_id, "total_amount": "100.00"}, expected="PENDING_MANAGER")
    _post(client, headers["manager"], request_id, "manager-approval", {"approve": True}, expected="PENDING_ORDER")
    _post(client, headers["store"], request_id, "order", expected="ORDERED")
    _post(client, headers["store"], request_id, "receive", expected="RECEIVED")
    _post(client, headers["staff"], request_id, "verify", {"matched": True}, expected="VERIFIED")
    _post(client, headers["bursar"], request_id, "pay", expected="PAID")
    resp = _post(client, headers["librarian"], request_id, "move-to-store", expected="IN_STORE")
    assert resp["status"] == "IN_STORE"
    item = db_session.scalar(select(StockItem).where(StockItem.item_name == "Staples"))
    assert item is not None
    assert item.quantity == 10
    moves = list(db_session.scalars(select(StockMovement).where(StockMovement.stock_item_id == item.id)).all())
    assert len(moves) >= 1
    assert all(m.movement_type == StockMovementType.IN for m in moves)

def test_stock_cannot_go_below_zero(
    db_session: Session, make_user, auth_headers
) -> None:
    branch, headers = _cast(db_session, make_user, auth_headers)
    user = db_session.scalar(select(User).where(User.email == "librarian.primarya@example.com"))
    inventory_service.add_stock(db_session, user=user, branch_id=branch.id, item_name="Pens", quantity=5)
    try:
        inventory_service.remove_stock(db_session, user=user, branch_id=branch.id, item_name="Pens", quantity=6)
        assert False, "should fail"
    except HTTPException as e:
        assert e.status_code == 400
    db_session.rollback()


def test_every_inventory_service_function_writes_stock_movement(
    db_session: Session, make_user, auth_headers
) -> None:
    branch, headers = _cast(db_session, make_user, auth_headers)
    user = db_session.scalar(select(User).where(User.email == "librarian.primarya@example.com"))
    before = len(db_session.scalars(select(StockMovement)).all())
    inventory_service.add_stock(db_session, user=user, branch_id=branch.id, item_name="Paper", quantity=5)
    after_add = len(db_session.scalars(select(StockMovement)).all())
    assert after_add == before + 1
    inventory_service.remove_stock(db_session, user=user, branch_id=branch.id, item_name="Paper", quantity=2)
    after_rem = len(db_session.scalars(select(StockMovement)).all())
    assert after_rem == after_add + 1
    inventory_service.adjust_stock(db_session, user=user, branch_id=branch.id, item_name="Paper", new_quantity=10)
    after_adj = len(db_session.scalars(select(StockMovement)).all())
    assert after_adj == after_rem + 1
    db_session.rollback()


def test_cross_branch_visibility(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    branch_a, headers_a = _cast(db_session, make_user, auth_headers, "Primary A")
    _, headers_b = _cast(db_session, make_user, auth_headers, "Primary B")
    supplier_id = _register_supplier(client, headers_a["bursar"])
    request_id = _book_to_sent_to_school(client, headers_a, supplier_id)
    client.post("/library/catalogue", headers=headers_a["librarian"], json={"request_id": request_id})
    res = client.get("/library/books", headers=headers_b["librarian"])
    assert res.status_code == 200
    assert res.json() == []
    res = client.get("/library/books", headers=headers_a["admin"])
    assert res.status_code == 200
    assert len(res.json()) == 2
    user_a_lib = db_session.scalar(select(User).where(User.email == "librarian.primarya@example.com"))
    inventory_service.add_stock(db_session, user=user_a_lib, branch_id=branch_a.id, item_name="Glue", quantity=3)
    db_session.commit()
    res = client.get("/inventory", headers=headers_b["librarian"])
    assert res.json() == []
    res = client.get("/inventory", headers=headers_a["admin"])
    assert len(res.json()) >= 1


def test_utils_codes_unique_many(
    db_session: Session, make_user, auth_headers
) -> None:
    branch, headers = _cast(db_session, make_user, auth_headers)
    seen = set()
    for _ in range(100):
        c = codes.generate_copy_code(db_session, branch_name=branch.name)
        assert c not in seen
        seen.add(c)


def test_audit_rows_written_for_catalogue_and_move_to_store(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    _, headers = _cast(db_session, make_user, auth_headers)
    supplier_id = _register_supplier(client, headers["bursar"])
    request_id = _book_to_sent_to_school(client, headers, supplier_id)
    before = len(db_session.scalars(select(AuditLog).where(AuditLog.request_id == request_id)).all())
    client.post("/library/catalogue", headers=headers["librarian"], json={"request_id": request_id})
    after = len(db_session.scalars(select(AuditLog).where(AuditLog.request_id == request_id)).all())
    assert after == before + 1
    last = db_session.scalars(select(AuditLog).where(AuditLog.request_id == request_id).order_by(AuditLog.id.desc())).first()
    assert last.action == "CATALOGUE"
    request_id2 = _create_other_request(client, headers["staff"], "Buckets")
    _post(client, headers["head"], request_id2, "approve", expected="PENDING_BURSAR")
    _post(client, headers["bursar"], request_id2, "purchase-order", {"supplier_id": supplier_id, "total_amount": "50.00"}, expected="PENDING_MANAGER")
    _post(client, headers["manager"], request_id2, "manager-approval", {"approve": True}, expected="PENDING_ORDER")
    _post(client, headers["store"], request_id2, "order", expected="ORDERED")
    _post(client, headers["store"], request_id2, "receive", expected="RECEIVED")
    _post(client, headers["staff"], request_id2, "verify", {"matched": True}, expected="VERIFIED")
    _post(client, headers["bursar"], request_id2, "pay", expected="PAID")
    before2 = len(db_session.scalars(select(AuditLog).where(AuditLog.request_id == request_id2)).all())
    _post(client, headers["librarian"], request_id2, "move-to-store", expected="IN_STORE")
    after2 = len(db_session.scalars(select(AuditLog).where(AuditLog.request_id == request_id2)).all())
    assert after2 == before2 + 1
    last2 = db_session.scalars(select(AuditLog).where(AuditLog.request_id == request_id2).order_by(AuditLog.id.desc())).first()
    assert last2.action == "MOVE_TO_STORE"
