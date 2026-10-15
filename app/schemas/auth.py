"""Pydantic schemas for authentication."""

from __future__ import annotations

from pydantic import BaseModel


class LoginRequest(BaseModel):
    """Credentials submitted to ``/auth/login``."""

    email: str
    password: str


class RefreshRequest(BaseModel):
    """Refresh token submitted to ``/auth/refresh``."""

    refresh_token: str


class TokenResponse(BaseModel):
    """Access and refresh tokens returned by the auth endpoints."""

    access_token: str
    refresh_token: str
    token_type: str = "bearer"
