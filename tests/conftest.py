"""Shared pytest fixtures using an in-memory SQLite database."""

from __future__ import annotations

from collections.abc import Generator, Iterable

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401  (register models on Base.metadata)
from app.core.database import Base, get_db
from app.core.security import hash_password
from app.main import app
from app.models.user import Role, RoleAssignment, User

TEST_PASSWORD = "secret123"


@pytest.fixture()
def engine() -> Generator[Engine, None, None]:
    """Provide a fresh in-memory SQLite engine with all tables created."""
    engine = create_engine(
        "sqlite+pysqlite:///:memory:",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(engine)
    try:
        yield engine
    finally:
        Base.metadata.drop_all(engine)
        engine.dispose()


@pytest.fixture()
def db_session(engine: Engine) -> Generator[Session, None, None]:
    """Provide a session bound to the in-memory test engine."""
    testing_session = sessionmaker(
        bind=engine, autoflush=False, autocommit=False, expire_on_commit=False
    )
    session = testing_session()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture()
def client(db_session: Session) -> Generator[TestClient, None, None]:
    """Provide a TestClient whose ``get_db`` dependency uses the test session."""

    def override_get_db() -> Generator[Session, None, None]:
        yield db_session

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture()
def make_user(db_session: Session):
    """Factory that creates and persists a user with role assignments."""

    def _make_user(
        email: str = "user@example.com",
        roles: Iterable[Role] = (Role.REQUESTING_STAFF,),
        branch_ids: Iterable[int | None] = (None,),
        password: str = TEST_PASSWORD,
        is_active: bool = True,
    ) -> User:
        user = User(
            full_name="Test User",
            email=email,
            password_hash=hash_password(password),
            is_active=is_active,
        )
        user.assignments = [
            RoleAssignment(role=role, branch_id=branch_id)
            for role, branch_id in zip(roles, branch_ids)
        ]
        db_session.add(user)
        db_session.commit()
        db_session.refresh(user)
        return user

    return _make_user


@pytest.fixture()
def login(client: TestClient):
    """Factory that logs in and returns the JSON token response."""

    def _login(email: str, password: str = TEST_PASSWORD) -> dict[str, str]:
        response = client.post(
            "/auth/login", json={"email": email, "password": password}
        )
        assert response.status_code == 200, response.text
        return response.json()

    return _login


@pytest.fixture()
def auth_headers(login):
    """Factory that returns an Authorization header for a user."""

    def _auth_headers(email: str, password: str = TEST_PASSWORD) -> dict[str, str]:
        tokens = login(email, password)
        return {"Authorization": f"Bearer {tokens['access_token']}"}

    return _auth_headers
