"""Pydantic schemas for the library catalogue."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel

from app.models.library import BookCopyStatus


class CatalogueRequest(BaseModel):
    """Payload for cataloguing an approved BOOK request."""

    request_id: int


class BookCopyRead(BaseModel):
    """A book copy (with its title details) returned by the API."""

    id: int
    code: str
    title_id: int
    title: str
    author: str | None
    isbn: str | None
    branch_id: int
    status: BookCopyStatus
    request_id: int | None
    created_at: datetime
