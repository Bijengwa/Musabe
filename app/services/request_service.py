"""Request service: creation, listing, lookup, and approval decisions.

Business rules:

* A request starts in ``PENDING_ACADEMIC`` (BOOK) or ``PENDING_APPROVAL``
  (OTHER) as defined by :mod:`app.services.workflow`.
* School-role users may only see and act on requests of their own branch(es);
  central-role users see and act on all requests.
* Every status change goes through :func:`app.services.workflow.apply_transition`
  and is recorded by :mod:`app.services.audit_service`.
"""

from __future__ import annotations

from collections.abc import Sequence

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.models.branch import Branch
from app.models.request import Approval, ApprovalAction, Request, RequestLine
from app.models.user import CENTRAL_ROLES, SCHOOL_ROLES, Role, User
from app.schemas.request import RequestCreate
from app.services import audit_service, workflow


def _roles(user: User) -> set[Role]:
    """Return the set of roles held by ``user``."""
    return {assignment.role for assignment in user.assignments}


def is_central(user: User) -> bool:
    """Return ``True`` when ``user`` holds any central (all-branch) role."""
    return bool(_roles(user) & CENTRAL_ROLES)


def user_branch_ids(user: User) -> set[int]:
    """Return the branch ids a school-role user is scoped to."""
    return {
        assignment.branch_id
        for assignment in user.assignments
        if assignment.role in SCHOOL_ROLES and assignment.branch_id is not None
    }


def _scope_filter(user: User):
    """Return a SQLAlchemy filter limiting requests to those visible to ``user``."""
    if is_central(user):
        return None
    return Request.branch_id.in_(user_branch_ids(user))


def _resolve_branch(db: Session, user: User, branch_id: int | None) -> Branch:
    """Resolve and authorise the branch for a new request.

    Central-role users must supply ``branch_id``; school-role users default to
    their own branch and may only target a branch they belong to.

    Raises:
        HTTPException: 400 when the branch cannot be determined, 403 when a
            school-role user targets a foreign branch, or 404 when the branch
            does not exist.
    """
    allowed = user_branch_ids(user)
    if is_central(user):
        if branch_id is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="branch_id is required for central-role users",
            )
    elif branch_id is None:
        if len(allowed) != 1:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="branch_id is required when you belong to multiple branches",
            )
        branch_id = next(iter(allowed))
    elif branch_id not in allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You can only raise requests for your own branch",
        )

    branch = db.get(Branch, branch_id)
    if branch is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Branch not found",
        )
    return branch


def create_request(db: Session, user: User, data: RequestCreate) -> Request:
    """Create a request owned by ``user`` and starting at the workflow entry."""
    branch = _resolve_branch(db, user, data.branch_id)
    initial = workflow.initial_status(data.type)

    request = Request(
        type=data.type,
        status=initial,
        branch_id=branch.id,
        requestor_id=user.id,
        title=data.title,
        description=data.description,
    )
    request.lines = [
        RequestLine(
            description=line.description,
            quantity=line.quantity,
            unit=line.unit,
        )
        for line in data.lines
    ]
    db.add(request)
    db.flush()

    audit_service.log_action(
        db,
        action="CREATE",
        request_id=request.id,
        actor_id=user.id,
        from_status=None,
        to_status=initial.value,
    )

    db.commit()
    db.refresh(request)
    return request


def list_requests(db: Session, user: User) -> Sequence[Request]:
    """Return requests visible to ``user`` (branch-scoped for school roles)."""
    stmt = (
        select(Request)
        .options(selectinload(Request.lines), selectinload(Request.approvals))
        .order_by(Request.id)
    )
    scope = _scope_filter(user)
    if scope is not None:
        stmt = stmt.where(scope)
    return db.scalars(stmt).all()


def get_request(db: Session, user: User, request_id: int) -> Request:
    """Return a single visible request or raise 404.

    Out-of-scope requests are reported as not found so that school-role users
    cannot discover requests belonging to other branches.

    Raises:
        HTTPException: 404 if the request does not exist or is not visible.
    """
    request = db.get(Request, request_id)
    if request is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Request not found",
        )
    if not is_central(user) and request.branch_id not in user_branch_ids(user):
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Request not found",
        )
    return request


def _decide(
    db: Session,
    user: User,
    request_id: int,
    action: workflow.WorkflowAction,
    comment: str | None,
) -> Request:
    """Apply an approve/reject decision and record it.

    Raises:
        HTTPException: 404 if the request is not visible, 409 if the action is
            invalid for the current status, or 403 if the user's role is not
            allowed to perform the transition.
    """
    request = get_request(db, user, request_id)

    from_status = request.status
    new_status = workflow.apply_transition(
        request_type=request.type,
        current_status=from_status,
        action=action,
        roles=_roles(user),
    )

    db.add(
        Approval(
            request_id=request.id,
            approver_id=user.id,
            action=ApprovalAction(action.value),
            from_status=from_status,
            to_status=new_status,
            comment=comment,
        )
    )
    request.status = new_status

    audit_service.log_action(
        db,
        action=action.value,
        request_id=request.id,
        actor_id=user.id,
        from_status=from_status.value,
        to_status=new_status.value,
        detail=comment,
    )

    db.commit()
    db.refresh(request)
    return request


def approve_request(
    db: Session, user: User, request_id: int, comment: str | None = None
) -> Request:
    """Approve a request on behalf of ``user``."""
    return _decide(db, user, request_id, workflow.WorkflowAction.APPROVE, comment)


def reject_request(
    db: Session, user: User, request_id: int, comment: str | None = None
) -> Request:
    """Reject a request on behalf of ``user``, ending the workflow."""
    return _decide(db, user, request_id, workflow.WorkflowAction.REJECT, comment)
