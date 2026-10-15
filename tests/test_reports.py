"""Tests for management reports (Phase 7)."""

from __future__ import annotations

from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.branch import Branch, BranchType
from app.models.contribution import ParentContribution
from app.models.inventory import StockItem
from app.models.library import BookCopy, BookCopyStatus, BookTitle
from app.models.procurement import Payment, PurchaseOrder, Supplier
from app.models.request import Request, RequestStatus, RequestType
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
    db: Session,
    make_user,
    auth_headers,
    branch_name: str = "Primary A",
    branch_type: BranchType = BranchType.PRIMARY,
) -> tuple[Branch, dict[str, dict[str, str]]]:
    branch = _make_branch(db, branch_name, branch_type)
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


def _make_request(
    db: Session,
    branch: Branch,
    requestor_id: int,
    status: RequestStatus = RequestStatus.PENDING_APPROVAL,
    request_type: RequestType = RequestType.OTHER,
    title: str = "Chalk",
) -> Request:
    request = Request(
        type=request_type,
        status=status,
        branch_id=branch.id,
        requestor_id=requestor_id,
        title=title,
    )
    db.add(request)
    db.commit()
    db.refresh(request)
    return request


def _make_stock(
    db: Session, branch: Branch, name: str = "Uniform", quantity: int = 10
) -> StockItem:
    item = StockItem(branch_id=branch.id, item_name=name, quantity=quantity)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def _make_copy(
    db: Session,
    branch: Branch,
    code: str = "MUS-PA-2026-000001",
    copy_status: BookCopyStatus = BookCopyStatus.AVAILABLE,
) -> BookCopy:
    title = BookTitle(title="Test Book")
    db.add(title)
    db.flush()
    copy = BookCopy(
        code=code, title_id=title.id, branch_id=branch.id, status=copy_status
    )
    db.add(copy)
    db.commit()
    db.refresh(copy)
    return copy


def _make_spend(
    db: Session, branch: Branch, requestor_id: int, amount: str = "1000.00"
) -> Request:
    request = _make_request(
        db, branch, requestor_id, status=RequestStatus.PAID, title="Books"
    )
    supplier = Supplier(name=f"Supplier {branch.id}-{amount}")
    db.add(supplier)
    db.flush()
    db.add(
        PurchaseOrder(
            request_id=request.id,
            supplier_id=supplier.id,
            created_by_id=requestor_id,
            po_number=f"PO-{branch.id}-{amount}",
            total_amount=Decimal(amount),
        )
    )
    db.add(
        Payment(
            request_id=request.id,
            paid_by_id=requestor_id,
            amount=Decimal(amount),
        )
    )
    db.commit()
    return request


def test_overview_counts(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """The overview summarises requests, copies, stock, issues, and spend."""
    branch, headers = _cast(db_session, make_user, auth_headers)
    staff_id = make_user(
        email="requestor@example.com",
        roles=[Role.REQUESTING_STAFF],
        branch_ids=[branch.id],
    ).id

    _make_request(db_session, branch, staff_id, RequestStatus.PENDING_APPROVAL)
    _make_request(db_session, branch, staff_id, RequestStatus.IN_STORE)
    _make_copy(db_session, branch, copy_status=BookCopyStatus.AVAILABLE)
    _make_copy(db_session, branch, code="MUS-PA-2026-000002",
               copy_status=BookCopyStatus.ISSUED)
    _make_stock(db_session, branch, "Uniform", quantity=2)
    _make_stock(db_session, branch, "Chalk", quantity=50)
    _make_spend(db_session, branch, staff_id, "1500.00")

    response = client.get("/reports/overview", headers=headers["manager"])
    assert response.status_code == 200, response.text
    body = response.json()

    assert body["total_requests"] == 3
    assert body["pending_requests"] == 2
    assert body["total_book_copies"] == 2
    assert body["stock_items"] == 2
    assert body["low_stock_items"] == 1
    assert body["pending_writeoffs"] == 0
    assert Decimal(str(body["total_ordered"])) == Decimal("1500.00")
    assert Decimal(str(body["total_paid"])) == Decimal("1500.00")

    statuses = {s["status"]: s["count"] for s in body["requests_by_status"]}
    assert statuses["PENDING_APPROVAL"] == 1
    assert statuses["IN_STORE"] == 1
    assert statuses["PAID"] == 1


def test_pending_requests_excludes_terminal(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """Only non-terminal requests appear in the pending report."""
    branch, headers = _cast(db_session, make_user, auth_headers)
    staff_id = make_user(
        email="requestor@example.com",
        roles=[Role.REQUESTING_STAFF],
        branch_ids=[branch.id],
    ).id

    _make_request(db_session, branch, staff_id, RequestStatus.PENDING_BURSAR)
    _make_request(db_session, branch, staff_id, RequestStatus.IN_STORE)
    _make_request(db_session, branch, staff_id, RequestStatus.CATALOGUED)
    _make_request(db_session, branch, staff_id, RequestStatus.REJECTED)

    body = client.get(
        "/reports/pending-requests", headers=headers["manager"]
    ).json()
    assert [r["status"] for r in body] == ["PENDING_BURSAR"]


def test_spend_report_groups_by_branch(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """Spend is grouped per branch and can be scoped."""
    branch_a, headers_a = _cast(db_session, make_user, auth_headers, "Primary A")
    branch_b, _ = _cast(db_session, make_user, auth_headers, "Primary B")
    staff_a = make_user(
        email="ra@example.com", roles=[Role.REQUESTING_STAFF], branch_ids=[branch_a.id]
    ).id
    staff_b = make_user(
        email="rb@example.com", roles=[Role.REQUESTING_STAFF], branch_ids=[branch_b.id]
    ).id

    _make_spend(db_session, branch_a, staff_a, "100.00")
    _make_spend(db_session, branch_b, staff_b, "250.50")

    body = client.get("/reports/spend", headers=headers_a["admin"]).json()
    by_branch = {row["branch_name"]: row for row in body}
    assert Decimal(str(by_branch["Primary A"]["total_ordered"])) == Decimal("100.00")
    assert Decimal(str(by_branch["Primary B"]["total_paid"])) == Decimal("250.50")


def test_reports_scoped_to_branch(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """School roles only see their own branch; central roles see all."""
    branch_a, headers_a = _cast(db_session, make_user, auth_headers, "Primary A")
    branch_b, headers_b = _cast(db_session, make_user, auth_headers, "Primary B")
    staff_a = make_user(
        email="ra@example.com", roles=[Role.REQUESTING_STAFF], branch_ids=[branch_a.id]
    ).id
    staff_b = make_user(
        email="rb@example.com", roles=[Role.REQUESTING_STAFF], branch_ids=[branch_b.id]
    ).id
    _make_request(db_session, branch_a, staff_a, RequestStatus.PENDING_APPROVAL)
    _make_request(db_session, branch_b, staff_b, RequestStatus.PENDING_APPROVAL)
    _make_stock(db_session, branch_a, "Uniform", 10)
    _make_stock(db_session, branch_b, "Chalk", 10)

    a_overview = client.get("/reports/overview", headers=headers_a["head"]).json()
    assert a_overview["total_requests"] == 1
    assert a_overview["stock_items"] == 1

    stock_b = client.get("/reports/stock", headers=headers_b["librarian"]).json()
    assert len(stock_b) == 1
    assert stock_b[0]["item_name"] == "Chalk"

    all_stock = client.get("/reports/stock", headers=headers_a["admin"]).json()
    assert len(all_stock) == 2


def test_stock_report_low_flag(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """The stock report flags items at or below the low-stock threshold."""
    branch, headers = _cast(db_session, make_user, auth_headers)
    _make_stock(db_session, branch, "Low", quantity=5)
    _make_stock(db_session, branch, "Fine", quantity=6)

    body = client.get("/reports/stock", headers=headers["store"]).json()
    flags = {row["item_name"]: row["is_low"] for row in body}
    assert flags["Low"] is True
    assert flags["Fine"] is False


def test_outstanding_issues_report(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """Outstanding issues lists only unreturned items."""
    branch, headers = _cast(db_session, make_user, auth_headers)
    copy = _make_copy(db_session, branch, code="MUS-PA-2026-000050")

    issue = client.post(
        "/issues",
        headers=headers["librarian"],
        json={"borrower": "Ali", "book_code": copy.code},
    ).json()

    body = client.get(
        "/reports/outstanding-issues", headers=headers["librarian"]
    ).json()
    assert [i["id"] for i in body] == [issue["id"]]

    client.post(f"/issues/{issue['id']}/return", headers=headers["librarian"])
    after = client.get(
        "/reports/outstanding-issues", headers=headers["librarian"]
    ).json()
    assert after == []


def test_activity_report_scoped(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """Central roles see request audit rows; school roles only their branch."""
    branch, headers = _cast(db_session, make_user, auth_headers)
    staff_id = make_user(
        email="requestor@example.com",
        roles=[Role.REQUESTING_STAFF],
        branch_ids=[branch.id],
    ).id
    request = _make_request(
        db_session, branch, staff_id, RequestStatus.PENDING_APPROVAL
    )

    response = client.post(
        f"/requests/{request.id}/approve",
        headers=headers["head"],
        json={"comment": "ok"},
    )
    assert response.status_code == 200, response.text

    body = client.get("/reports/activity", headers=headers["admin"]).json()
    assert any(row["action"] for row in body)
    assert any(row["request_id"] == request.id for row in body)

    scoped = client.get("/reports/activity", headers=headers["head"]).json()
    assert all(row["request_id"] == request.id for row in scoped)
