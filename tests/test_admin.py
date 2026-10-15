"""Tests for admin endpoints (branches and staff)."""

from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.branch import Branch, BranchType
from app.models.user import Role, RoleAssignment, User


def _make_branch(db: Session, name: str = "Nursery & Primary") -> Branch:
    branch = Branch(name=name, type=BranchType.PRIMARY)
    db.add(branch)
    db.commit()
    db.refresh(branch)
    return branch


def test_non_admin_blocked(
    client: TestClient, make_user, auth_headers
) -> None:
    """A non-admin user cannot access admin endpoints."""
    make_user(email="librarian@example.com", roles=[Role.LIBRARIAN])
    headers = auth_headers("librarian@example.com")
    assert client.get("/admin/branches", headers=headers).status_code == 403
    assert client.get("/admin/staff", headers=headers).status_code == 403


def test_admin_required_for_anonymous(client: TestClient) -> None:
    """Anonymous access to admin endpoints is unauthorized."""
    assert client.get("/admin/branches").status_code == 401


def test_admin_creates_and_lists_branch(
    client: TestClient, make_user, auth_headers
) -> None:
    """An admin can create a branch and see it in the list."""
    make_user(email="admin@example.com", roles=[Role.ADMIN])
    headers = auth_headers("admin@example.com")

    created = client.post(
        "/admin/branches",
        headers=headers,
        json={"name": "Girls Secondary", "type": "SECONDARY"},
    )
    assert created.status_code == 201
    assert created.json()["type"] == "SECONDARY"

    listed = client.get("/admin/branches", headers=headers)
    assert listed.status_code == 200
    assert [b["name"] for b in listed.json()] == ["Girls Secondary"]


def test_duplicate_branch_conflict(
    client: TestClient, make_user, auth_headers
) -> None:
    """Creating a branch with an existing name returns 409."""
    make_user(email="admin@example.com", roles=[Role.ADMIN])
    headers = auth_headers("admin@example.com")
    payload = {"name": "Boys Secondary", "type": "SECONDARY"}
    assert client.post("/admin/branches", headers=headers, json=payload).status_code == 201
    assert client.post("/admin/branches", headers=headers, json=payload).status_code == 409


def test_create_school_staff_with_branch(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """A school-role staff member gets a branch-scoped assignment."""
    make_user(email="admin@example.com", roles=[Role.ADMIN])
    headers = auth_headers("admin@example.com")
    branch = _make_branch(db_session)

    response = client.post(
        "/admin/staff",
        headers=headers,
        json={
            "full_name": "Linda Librarian",
            "email": "linda@example.com",
            "password": "secret123",
            "role": "LIBRARIAN",
            "branch_ids": [branch.id],
        },
    )
    assert response.status_code == 201, response.text
    body = response.json()
    assert body["assignments"] == [{"role": "LIBRARIAN", "branch_id": branch.id}]

    stored = db_session.scalar(select(User).where(User.email == "linda@example.com"))
    assert stored is not None
    assert stored.assignments[0].branch_id == branch.id


def test_create_central_staff_has_no_branch(
    client: TestClient, make_user, auth_headers
) -> None:
    """A central-role staff member is assigned globally (branch_id None)."""
    make_user(email="admin@example.com", roles=[Role.ADMIN])
    headers = auth_headers("admin@example.com")

    response = client.post(
        "/admin/staff",
        headers=headers,
        json={
            "full_name": "Sam Storekeeper",
            "email": "sam@example.com",
            "password": "secret123",
            "role": "STOREKEEPER",
            "branch_ids": [],
        },
    )
    assert response.status_code == 201, response.text
    assert response.json()["assignments"] == [
        {"role": "STOREKEEPER", "branch_id": None}
    ]


def test_school_role_requires_branch(
    client: TestClient, make_user, auth_headers
) -> None:
    """Creating a school-role staff member without a branch returns 400."""
    make_user(email="admin@example.com", roles=[Role.ADMIN])
    headers = auth_headers("admin@example.com")

    response = client.post(
        "/admin/staff",
        headers=headers,
        json={
            "full_name": "No Branch",
            "email": "nobranch@example.com",
            "password": "secret123",
            "role": "HEAD_MASTER",
            "branch_ids": [],
        },
    )
    assert response.status_code == 400


def test_create_staff_unknown_branch(
    client: TestClient, make_user, auth_headers
) -> None:
    """Assigning a non-existent branch returns 404."""
    make_user(email="admin@example.com", roles=[Role.ADMIN])
    headers = auth_headers("admin@example.com")

    response = client.post(
        "/admin/staff",
        headers=headers,
        json={
            "full_name": "Ghost Branch",
            "email": "ghostbranch@example.com",
            "password": "secret123",
            "role": "LIBRARIAN",
            "branch_ids": [999],
        },
    )
    assert response.status_code == 404


def test_duplicate_staff_email_conflict(
    client: TestClient, make_user, auth_headers
) -> None:
    """Registering an email that already exists returns 409."""
    make_user(email="admin@example.com", roles=[Role.ADMIN])
    headers = auth_headers("admin@example.com")
    payload = {
        "full_name": "Duplicate",
        "email": "dup@example.com",
        "password": "secret123",
        "role": "STOREKEEPER",
        "branch_ids": [],
    }
    assert client.post("/admin/staff", headers=headers, json=payload).status_code == 201
    assert client.post("/admin/staff", headers=headers, json=payload).status_code == 409


def test_list_staff(
    client: TestClient, make_user, auth_headers
) -> None:
    """Listing staff returns created members with their assignments."""
    make_user(email="admin@example.com", roles=[Role.ADMIN])
    headers = auth_headers("admin@example.com")
    client.post(
        "/admin/staff",
        headers=headers,
        json={
            "full_name": "Mary Manager",
            "email": "mary@example.com",
            "password": "secret123",
            "role": "MANAGER",
        },
    )
    response = client.get("/admin/staff", headers=headers)
    assert response.status_code == 200
    emails = {u["email"] for u in response.json()}
    assert {"admin@example.com", "mary@example.com"} <= emails


def test_update_staff_role_and_deactivate(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """PATCH can change active status and switch to a central role."""
    make_user(email="admin@example.com", roles=[Role.ADMIN])
    headers = auth_headers("admin@example.com")
    branch = _make_branch(db_session)

    created = client.post(
        "/admin/staff",
        headers=headers,
        json={
            "full_name": "Changing Role",
            "email": "change@example.com",
            "password": "secret123",
            "role": "LIBRARIAN",
            "branch_ids": [branch.id],
        },
    ).json()

    response = client.patch(
        f"/admin/staff/{created['id']}",
        headers=headers,
        json={"role": "MANAGER", "is_active": False},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["is_active"] is False
    assert body["assignments"] == [{"role": "MANAGER", "branch_id": None}]

    stored = db_session.get(User, created["id"])
    assert stored is not None and stored.is_active is False
