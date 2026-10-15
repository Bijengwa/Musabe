"""Tests for issuing book copies and stock items (Phase 6)."""

from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.audit import AuditLog
from app.models.branch import Branch, BranchType
from app.models.inventory import StockItem, StockMovement, StockMovementType
from app.models.library import BookCopy, BookCopyStatus, BookTitle
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
        code=code,
        title_id=title.id,
        branch_id=branch.id,
        status=copy_status,
    )
    db.add(copy)
    db.commit()
    db.refresh(copy)
    return copy


def _make_stock(
    db: Session, branch: Branch, name: str = "Uniform", quantity: int = 10
) -> StockItem:
    item = StockItem(branch_id=branch.id, item_name=name, quantity=quantity)
    db.add(item)
    db.commit()
    db.refresh(item)
    return item


def test_issue_and_return_book(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """A Librarian issues an available book copy and later returns it."""
    branch, headers = _cast(db_session, make_user, auth_headers)
    copy = _make_copy(db_session, branch, code="MUS-PA-2026-000001")

    response = client.post(
        "/issues",
        headers=headers["librarian"],
        json={"borrower": "Ali", "book_code": copy.code},
    )
    assert response.status_code == 201, response.text
    issue = response.json()
    assert issue["status"] == "ISSUED"
    assert issue["book_copy_id"] == copy.id

    db_session.refresh(copy)
    assert copy.status == BookCopyStatus.ISSUED

    returned = client.post(
        f"/issues/{issue['id']}/return", headers=headers["librarian"]
    )
    assert returned.status_code == 200, returned.text
    body = returned.json()
    assert body["status"] == "RETURNED"
    assert body["returned_at"] is not None

    db_session.refresh(copy)
    assert copy.status == BookCopyStatus.AVAILABLE


def test_cannot_issue_already_issued_book(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """A copy that is already ISSUED cannot be issued again."""
    branch, headers = _cast(db_session, make_user, auth_headers)
    copy = _make_copy(
        db_session, branch, code="MUS-PA-2026-000002",
        copy_status=BookCopyStatus.ISSUED,
    )

    response = client.post(
        "/issues",
        headers=headers["librarian"],
        json={"borrower": "Ali", "book_code": copy.code},
    )
    assert response.status_code == 409


def test_non_librarian_cannot_issue(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """Only a Librarian may issue items."""
    branch, headers = _cast(db_session, make_user, auth_headers)
    copy = _make_copy(db_session, branch, code="MUS-PA-2026-000003")

    for key in ("store", "head", "staff"):
        response = client.post(
            "/issues",
            headers=headers[key],
            json={"borrower": "Ali", "book_code": copy.code},
        )
        assert response.status_code == 403, key


def test_stock_issue_reduces_quantity(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """Issuing stock writes an OUT movement and reduces the quantity."""
    branch, headers = _cast(db_session, make_user, auth_headers)
    item = _make_stock(db_session, branch, "Uniform", quantity=10)

    response = client.post(
        "/issues",
        headers=headers["librarian"],
        json={"borrower": "Ali", "item_name": "Uniform", "quantity": 3},
    )
    assert response.status_code == 201, response.text
    assert response.json()["quantity"] == 3

    db_session.refresh(item)
    assert item.quantity == 7

    movements = list(
        db_session.scalars(
            select(StockMovement).where(StockMovement.stock_item_id == item.id)
        ).all()
    )
    assert any(
        m.movement_type == StockMovementType.OUT and m.quantity == 3
        for m in movements
    )


def test_issue_beyond_stock_blocked(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """Issuing more than is in stock is rejected and leaves stock unchanged."""
    branch, headers = _cast(db_session, make_user, auth_headers)
    item = _make_stock(db_session, branch, "Uniform", quantity=5)

    response = client.post(
        "/issues",
        headers=headers["librarian"],
        json={"borrower": "Ali", "item_name": "Uniform", "quantity": 10},
    )
    assert response.status_code == 400

    db_session.refresh(item)
    assert item.quantity == 5


def test_issue_by_size_defaults_quantity_one(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """A stock issue by size only issues a single item."""
    branch, headers = _cast(db_session, make_user, auth_headers)
    item = _make_stock(db_session, branch, "Shoes", quantity=10)

    response = client.post(
        "/issues",
        headers=headers["librarian"],
        json={"borrower": "Ali", "item_name": "Shoes", "size": "M"},
    )
    assert response.status_code == 201, response.text
    assert response.json()["quantity"] == 1
    assert response.json()["size"] == "M"

    db_session.refresh(item)
    assert item.quantity == 9


def test_list_issues_filters(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """Issues can be filtered by borrower and status."""
    branch, headers = _cast(db_session, make_user, auth_headers)
    first = _make_copy(db_session, branch, code="MUS-PA-2026-000010")
    second = _make_copy(db_session, branch, code="MUS-PA-2026-000011")

    client.post(
        "/issues",
        headers=headers["librarian"],
        json={"borrower": "Ali", "book_code": first.code},
    )
    bob = client.post(
        "/issues",
        headers=headers["librarian"],
        json={"borrower": "Bob", "book_code": second.code},
    ).json()

    by_borrower = client.get(
        "/issues?borrower=Ali", headers=headers["librarian"]
    ).json()
    assert len(by_borrower) == 1
    assert by_borrower[0]["borrower"] == "Ali"

    issued = client.get("/issues?status=ISSUED", headers=headers["librarian"]).json()
    assert len(issued) == 2

    client.post(f"/issues/{bob['id']}/return", headers=headers["librarian"])
    returned = client.get(
        "/issues?status=RETURNED", headers=headers["librarian"]
    ).json()
    assert len(returned) == 1


def test_issue_visibility_scoped_by_branch(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """School roles see only their branch's issues; central roles see all."""
    branch_a, headers_a = _cast(db_session, make_user, auth_headers, "Primary A")
    _, headers_b = _cast(db_session, make_user, auth_headers, "Primary B")
    copy = _make_copy(db_session, branch_a, code="MUS-PA-2026-000020")
    client.post(
        "/issues",
        headers=headers_a["librarian"],
        json={"borrower": "Ali", "book_code": copy.code},
    )

    assert client.get("/issues", headers=headers_b["librarian"]).json() == []
    assert len(client.get("/issues", headers=headers_a["admin"]).json()) == 1


def test_issue_and_return_write_audit_rows(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """Issuing and returning each write an audit row."""
    branch, headers = _cast(db_session, make_user, auth_headers)
    copy = _make_copy(db_session, branch, code="MUS-PA-2026-000030")

    issue = client.post(
        "/issues",
        headers=headers["librarian"],
        json={"borrower": "Ali", "book_code": copy.code},
    ).json()
    client.post(f"/issues/{issue['id']}/return", headers=headers["librarian"])

    actions = [
        row.action
        for row in db_session.scalars(select(AuditLog).order_by(AuditLog.id)).all()
    ]
    assert "ISSUE" in actions
    assert "RETURN" in actions
