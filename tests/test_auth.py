"""Tests for authentication endpoints."""

from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.models.branch import Branch, BranchType
from app.models.user import Role
from tests.conftest import TEST_PASSWORD


def test_login_success(
    client: TestClient, make_user, login
) -> None:
    """A valid email/password returns an access and refresh token."""
    make_user(email="admin@example.com", roles=[Role.ADMIN])
    tokens = login("admin@example.com")
    assert tokens["token_type"] == "bearer"
    assert tokens["access_token"]
    assert tokens["refresh_token"]


def test_login_wrong_password(client: TestClient, make_user) -> None:
    """An incorrect password is rejected with 401."""
    make_user(email="wrong@example.com")
    response = client.post(
        "/auth/login",
        json={"email": "wrong@example.com", "password": "nope"},
    )
    assert response.status_code == 401


def test_login_unknown_email(client: TestClient) -> None:
    """An unknown email is rejected with 401."""
    response = client.post(
        "/auth/login", json={"email": "ghost@example.com", "password": "x"}
    )
    assert response.status_code == 401


def test_login_inactive_user(client: TestClient, make_user) -> None:
    """An inactive user cannot log in."""
    make_user(email="inactive@example.com", is_active=False)
    response = client.post(
        "/auth/login",
        json={"email": "inactive@example.com", "password": TEST_PASSWORD},
    )
    assert response.status_code == 401


def test_me_returns_current_user(
    client: TestClient, db_session: Session, make_user, login
) -> None:
    """``/auth/me`` returns the authenticated user's profile and roles."""
    make_user(email="me@example.com", roles=[Role.BURSAR])
    tokens = login("me@example.com")
    response = client.get(
        "/auth/me", headers={"Authorization": f"Bearer {tokens['access_token']}"}
    )
    assert response.status_code == 200
    body = response.json()
    assert body["email"] == "me@example.com"
    assert body["assignments"][0]["role"] == "BURSAR"


def test_me_requires_token(client: TestClient) -> None:
    """``/auth/me`` without a token is unauthorized."""
    assert client.get("/auth/me").status_code == 401


def test_refresh_returns_new_tokens(client: TestClient, make_user, login) -> None:
    """A valid refresh token yields a new token pair."""
    make_user(email="refresh@example.com")
    tokens = login("refresh@example.com")
    response = client.post(
        "/auth/refresh", json={"refresh_token": tokens["refresh_token"]}
    )
    assert response.status_code == 200
    assert response.json()["access_token"]


def test_refresh_rejects_access_token(client: TestClient, make_user, login) -> None:
    """An access token cannot be used at the refresh endpoint."""
    make_user(email="badrefresh@example.com")
    tokens = login("badrefresh@example.com")
    response = client.post(
        "/auth/refresh", json={"refresh_token": tokens["access_token"]}
    )
    assert response.status_code == 401
