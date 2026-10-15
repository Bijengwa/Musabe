"""Tests for writing off lost or damaged book copies (Phase 6)."""

from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.audit import AuditLog
from app.models.branch import Branch, BranchType
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


def _create_writeoff(
    client: TestClient,
    headers: dict[str, str],
    code: str,
    reason: str = "LOST",
    report: str = "Left on the bus",
) -> dict:
    response = client.post(
        "/write-offs",
        headers=headers,
        json={"book_code": code, "reason": reason, "report": report},
    )
    assert response.status_code == 201, response.text
    return response.json()


def test_create_writeoff_is_pending(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """A Librarian records a PENDING write-off with a reason and report."""
    branch, headers = _cast(db_session, make_user, auth_headers)
    copy = _make_copy(db_session, branch, code="MUS-PA-2026-000001")

    body = _create_writeoff(client, headers["librarian"], copy.code)
    assert body["status"] == "PENDING"
    assert body["reason"] == "LOST"
    assert body["report"] == "Left on the bus"

    db_session.refresh(copy)
    assert copy.status == BookCopyStatus.AVAILABLE


def test_head_master_approval_writes_off_copy(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """Approving a write-off sets the copy to WRITTEN_OFF."""
    branch, headers = _cast(db_session, make_user, auth_headers)
    copy = _make_copy(db_session, branch, code="MUS-PA-2026-000002")
    writeoff = _create_writeoff(client, headers["librarian"], copy.code)

    response = client.post(
        f"/write-offs/{writeoff['id']}/approve",
        headers=headers["head"],
        json={"approve": True, "note": "Confirmed lost"},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["status"] == "APPROVED"
    assert body["reviewed_by_id"] is not None
    assert body["reviewed_at"] is not None

    db_session.refresh(copy)
    assert copy.status == BookCopyStatus.WRITTEN_OFF


def test_rejected_writeoff_leaves_copy_unchanged(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """A rejected write-off leaves the copy untouched."""
    branch, headers = _cast(db_session, make_user, auth_headers)
    copy = _make_copy(db_session, branch, code="MUS-PA-2026-000003")
    writeoff = _create_writeoff(client, headers["librarian"], copy.code)

    response = client.post(
        f"/write-offs/{writeoff['id']}/approve",
        headers=headers["head"],
        json={"approve": False, "note": "Found on shelf"},
    )
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "REJECTED"

    db_session.refresh(copy)
    assert copy.status == BookCopyStatus.AVAILABLE


def test_librarian_cannot_approve(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """Only the Head Master may decide a write-off."""
    branch, headers = _cast(db_session, make_user, auth_headers)
    copy = _make_copy(db_session, branch, code="MUS-PA-2026-000004")
    writeoff = _create_writeoff(client, headers["librarian"], copy.code)

    response = client.post(
        f"/write-offs/{writeoff['id']}/approve",
        headers=headers["librarian"],
        json={"approve": True},
    )
    assert response.status_code == 403


def test_non_librarian_cannot_create_writeoff(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """Only the Librarian may record a write-off."""
    branch, headers = _cast(db_session, make_user, auth_headers)
    copy = _make_copy(db_session, branch, code="MUS-PA-2026-000005")

    response = client.post(
        "/write-offs",
        headers=headers["head"],
        json={"book_code": copy.code, "reason": "DAMAGED"},
    )
    assert response.status_code == 403


def test_other_branch_head_master_blocked(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """A Head Master from another branch cannot decide a write-off."""
    branch_a, headers_a = _cast(db_session, make_user, auth_headers, "Primary A")
    _, headers_b = _cast(db_session, make_user, auth_headers, "Primary B")
    copy = _make_copy(db_session, branch_a, code="MUS-PA-2026-000006")
    writeoff = _create_writeoff(client, headers_a["librarian"], copy.code)

    response = client.post(
        f"/write-offs/{writeoff['id']}/approve",
        headers=headers_b["head"],
        json={"approve": True},
    )
    assert response.status_code == 404

    db_session.refresh(copy)
    assert copy.status == BookCopyStatus.AVAILABLE


def test_duplicate_decision_blocked(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """A write-off can only be decided once."""
    branch, headers = _cast(db_session, make_user, auth_headers)
    copy = _make_copy(db_session, branch, code="MUS-PA-2026-000007")
    writeoff = _create_writeoff(client, headers["librarian"], copy.code)

    client.post(
        f"/write-offs/{writeoff['id']}/approve",
        headers=headers["head"],
        json={"approve": True},
    )
    again = client.post(
        f"/write-offs/{writeoff['id']}/approve",
        headers=headers["head"],
        json={"approve": False},
    )
    assert again.status_code == 409


def test_writeoff_audit_rows(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """Recording and deciding a write-off each write an audit row."""
    branch, headers = _cast(db_session, make_user, auth_headers)
    copy = _make_copy(db_session, branch, code="MUS-PA-2026-000008")
    writeoff = _create_writeoff(client, headers["librarian"], copy.code)
    client.post(
        f"/write-offs/{writeoff['id']}/approve",
        headers=headers["head"],
        json={"approve": True},
    )

    actions = [
        row.action
        for row in db_session.scalars(select(AuditLog).order_by(AuditLog.id)).all()
    ]
    assert "WRITE_OFF" in actions
    assert "WRITE_OFF_APPROVE" in actions
