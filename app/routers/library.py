"""Library endpoints: catalogue and book copy queries."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.permissions import get_current_user, require_roles
from app.models.library import BookCopyStatus
from app.models.request import Request
from app.models.user import Role, User
from app.schemas.library import BookCopyRead, CatalogueRequest
from app.schemas.request import RequestRead
from app.services import inventory_service

router = APIRouter(prefix="/library", tags=["library"])


@router.post("/catalogue", response_model=RequestRead)
def catalogue_request(
    payload: CatalogueRequest,
    user: User = Depends(require_roles(Role.LIBRARIAN)),
    db: Session = Depends(get_db),
) -> Request:
    """Catalogue a BOOK request that has been sent to the school (LIBRARIAN)."""
    return inventory_service.catalogue_request(db, user, payload.request_id)


@router.get("/books", response_model=list[BookCopyRead])
def list_books(
    title: str | None = None,
    status: BookCopyStatus | None = None,
    branch_id: int | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> list[BookCopyRead]:
    """List book copies, optionally filtered by title, status, and branch."""
    return inventory_service.list_books(
        db, user, title=title, book_status=status, branch_id=branch_id
    )


@router.get("/books/{code}", response_model=BookCopyRead)
def get_book(
    code: str,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
) -> BookCopyRead:
    """Return a single book copy by its code."""
    return inventory_service.get_book(db, user, code)
