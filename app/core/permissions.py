"""Authentication/authorization dependencies."""

from __future__ import annotations

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import decode_token
from app.models.user import Role, User

_bearer_scheme = HTTPBearer(auto_error=True)


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    """Resolve the authenticated user from a bearer access token.

    Raises:
        HTTPException: 401 when the token is invalid, expired, or the user is
            missing or inactive.
    """
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = decode_token(credentials.credentials, expected_type="access")
    except jwt.InvalidTokenError as exc:
        raise unauthorized from exc

    user = db.get(User, int(payload["sub"]))
    if user is None or not user.is_active:
        raise unauthorized
    return user


def user_roles(user: User) -> set[Role]:
    """Return the set of roles assigned to ``user``."""
    return {assignment.role for assignment in user.assignments}


def require_roles(*roles: Role):
    """Return a dependency that allows only users holding one of ``roles``."""

    allowed = set(roles)

    def dependency(user: User = Depends(get_current_user)) -> User:
        if not (user_roles(user) & allowed):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions",
            )
        return user

    return dependency
