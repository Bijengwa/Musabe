"""Tests for parent contributions to PRIMARY branches (Phase 6)."""

from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.audit import AuditLog
from app.models.branch import Branch, BranchType
from app.models.contribution import ParentContribution
from app.models.inventory import StockItem, StockMovement, StockMovementType
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


def test_contribution_primary_increases_stock(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """A contribution on a PRIMARY branch increases stock with a PARENT move."""
    branch, headers = _cast(db_session, make_user, auth_headers)

    response = client.post(
        "/contributions",
        headers=headers["librarian"],
        json={
            "item_name": "Exercise books",
            "quantity": 20,
            "contributor": "Mrs X",
            "note": "Term one",
        },
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["quantity"] == 20
    assert body["item_name"] == "Exercise books"

    item = db_session.scalar(
        select(StockItem).where(
            StockItem.branch_id == branch.id,
            StockItem.item_name == "Exercise books",
        )
    )
    assert item is not None
    assert item.quantity == 20

    movements = list(
        db_session.scalars(
            select(StockMovement).where(StockMovement.stock_item_id == item.id)
        ).all()
    )
    assert any(
        m.movement_type == StockMovementType.PARENT and m.quantity == 20
        for m in movements
    )

    stored = db_session.scalar(select(ParentContribution))
    assert stored is not None
    assert stored.quantity == 20


def test_contribution_secondary_branch_fails(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """Contributions to a SECONDARY branch are rejected with 400."""
    branch, headers = _cast(
        db_session, make_user, auth_headers,
        branch_name="Girls Secondary", branch_type=BranchType.SECONDARY,
    )

    response = client.post(
        "/contributions",
        headers=headers["librarian"],
        json={"item_name": "Exercise books", "quantity": 20},
    )
    assert response.status_code == 400
    assert db_session.scalar(select(ParentContribution)) is None
    assert db_session.scalar(select(StockItem)) is None


def test_non_librarian_cannot_contribute(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """Only the Librarian may record a contribution."""
    branch, headers = _cast(db_session, make_user, auth_headers)

    for key in ("head", "store", "staff"):
        response = client.post(
            "/contributions",
            headers=headers[key],
            json={"item_name": "Exercise books", "quantity": 5},
        )
        assert response.status_code == 403, key


def test_contribution_visibility_scoped_by_branch(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """School roles see only their branch's contributions; central sees all."""
    branch_a, headers_a = _cast(db_session, make_user, auth_headers, "Primary A")
    _, headers_b = _cast(db_session, make_user, auth_headers, "Primary B")

    client.post(
        "/contributions",
        headers=headers_a["librarian"],
        json={"item_name": "Exercise books", "quantity": 20},
    )

    assert client.get("/contributions", headers=headers_b["librarian"]).json() == []
    assert len(client.get("/contributions", headers=headers_a["admin"]).json()) == 1


def test_contribution_writes_audit_row(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """Recording a contribution writes an audit row."""
    branch, headers = _cast(db_session, make_user, auth_headers)

    client.post(
        "/contributions",
        headers=headers["librarian"],
        json={"item_name": "Exercise books", "quantity": 20},
    )

    actions = [
        row.action
        for row in db_session.scalars(select(AuditLog).order_by(AuditLog.id)).all()
    ]
    assert "CONTRIBUTION" in actions
