"""Authentication service: credential checks and token issuance."""

from __future__ import annotations

import jwt
from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    verify_password,
)
from app.models.user import User
from app.schemas.auth import TokenResponse


def authenticate_user(db: Session, email: str, password: str) -> User | None:
    """Return the matching active user, or ``None`` if credentials are invalid."""
    user = db.scalar(select(User).where(User.email == email))
    if user is None or not verify_password(password, user.password_hash):
        return None
    if not user.is_active:
        return None
    return user


def issue_tokens(user: User) -> TokenResponse:
    """Create a fresh access/refresh token pair for ``user``."""
    return TokenResponse(
        access_token=create_access_token(user.id),
        refresh_token=create_refresh_token(user.id),
    )


def login(db: Session, email: str, password: str) -> TokenResponse:
    """Authenticate ``email``/``password`` and return a token pair.

    Raises:
        HTTPException: 401 when the credentials are invalid or the user is
            inactive.
    """
    user = authenticate_user(db, email, password)
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return issue_tokens(user)


def refresh(db: Session, refresh_token: str) -> TokenResponse:
    """Exchange a valid refresh token for a new token pair.

    Raises:
        HTTPException: 401 when the token is invalid or the user is missing or
            inactive.
    """
    try:
        payload = decode_token(refresh_token, expected_type="refresh")
    except jwt.InvalidTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token",
            headers={"WWW-Authenticate": "Bearer"},
        ) from exc

    user = db.get(User, int(payload["sub"]))
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid refresh token",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return issue_tokens(user)
