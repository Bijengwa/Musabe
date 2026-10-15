"""Issuing endpoints: lending and returning book copies and stock items."""

from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.permissions import get_current_user, require_roles
from app.models.issuing import IssueStatus
from app.models.user import Role, User
from app.schemas.issuing import IssueCreate, IssueRead
from app.services import issuing_service

router = APIRouter(prefix="/issues", tags=["issuing"])


@router.post("", response_model=IssueRead, status_code=201)
def create_issue(
    payload: IssueCreate,
    user: User = Depends(require_roles(Role.LIBRARIAN)),
    db: Session = Depends(get_db),
):
    """Issue a book copy or stock item for the Librarian's own branch."""
    return issuing_service.create_issue(db, user, payload)


@router.post("/{issue_id}/return", response_model=IssueRead)
def return_issue(
    issue_id: int,
    user: User = Depends(require_roles(Role.LIBRARIAN)),
    db: Session = Depends(get_db),
):
    """Return an issue, making a book copy available again."""
    return issuing_service.return_issue(db, user, issue_id)


@router.get("", response_model=list[IssueRead])
def list_issues(
    borrower: str | None = None,
    status: IssueStatus | None = None,
    branch_id: int | None = None,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List issues, optionally filtered by borrower, status, and branch."""
    return issuing_service.list_issues(
        db, user, borrower=borrower, issue_status=status, branch_id=branch_id
    )
