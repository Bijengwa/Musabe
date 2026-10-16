"""Request approval and procurement workflow engine.

This module is the single source of truth for request state transitions.
A transition is described by ``(request type, current status, action)`` and
maps to a ``(next status, allowed roles)`` pair. Nothing outside this module
decides what a request's next status should be.

BOOK flow::

    PENDING_ACADEMIC -approve-> PENDING_HEAD_MASTER -approve-> APPROVED
    APPROVED -requisition-> PENDING_BURSAR
    PENDING_BURSAR -purchase_order-> PENDING_MANAGER
    PENDING_MANAGER -approve-> PENDING_ORDER -order-> ORDERED
    ORDERED -receive-> RECEIVED -verify_true-> VERIFIED
    RECEIVED -verify_false-> DISPUTED
    VERIFIED -pay-> PAID -send_to_school-> SENT_TO_SCHOOL
    SENT_TO_SCHOOL -catalogue-> CATALOGUED

OTHER flow::

    PENDING_APPROVAL -approve-> APPROVED
    APPROVED -requisition-> PENDING_BURSAR
    PENDING_BURSAR -purchase_order-> PENDING_MANAGER
    PENDING_MANAGER -approve-> PENDING_ORDER -order-> ORDERED
    ORDERED -receive-> RECEIVED -verify_true-> VERIFIED
    RECEIVED -verify_false-> DISPUTED
    VERIFIED -pay-> PAID -move_to_store-> IN_STORE

At any pending status the owner role may ``reject`` where a reject edge is
defined; rejection moves the request to ``REJECTED``.
"""

from __future__ import annotations

import enum
from collections.abc import Iterable

from fastapi import HTTPException, status

from app.models.request import RequestStatus, RequestType
from app.models.user import Role


class WorkflowAction(str, enum.Enum):
    """An action a user can attempt against a request."""

    APPROVE = "APPROVE"
    REJECT = "REJECT"
    REQUISITION = "REQUISITION"
    PURCHASE_ORDER = "PURCHASE_ORDER"
    ORDER = "ORDER"
    RECEIVE = "RECEIVE"
    VERIFY_TRUE = "VERIFY_TRUE"
    VERIFY_FALSE = "VERIFY_FALSE"
    PAY = "PAY"
    SEND_TO_SCHOOL = "SEND_TO_SCHOOL"
    MOVE_TO_STORE = "MOVE_TO_STORE"
    CATALOGUE = "CATALOGUE"


class _Transition:
    """A single workflow edge: next status plus the roles allowed to take it."""

    __slots__ = ("next_status", "allowed_roles")

    def __init__(
        self, next_status: RequestStatus, allowed_roles: Iterable[Role]
    ) -> None:
        self.next_status = next_status
        self.allowed_roles = frozenset(allowed_roles)


_R = RequestStatus
_A = WorkflowAction

# Steps shared by the BOOK and OTHER flows.
_COMMON: dict[tuple[RequestStatus, WorkflowAction], _Transition] = {
    (_R.PENDING_BURSAR, _A.PURCHASE_ORDER): _Transition(
        _R.PENDING_MANAGER, {Role.BURSAR}
    ),
    (_R.PENDING_MANAGER, _A.APPROVE): _Transition(
        _R.PENDING_ORDER, {Role.MANAGER}
    ),
    (_R.PENDING_MANAGER, _A.REJECT): _Transition(_R.REJECTED, {Role.MANAGER}),
    (_R.PENDING_ORDER, _A.ORDER): _Transition(_R.ORDERED, {Role.STOREKEEPER}),
    (_R.ORDERED, _A.RECEIVE): _Transition(_R.RECEIVED, {Role.STOREKEEPER}),
    (_R.RECEIVED, _A.VERIFY_TRUE): _Transition(_R.VERIFIED, set(Role)),
    (_R.RECEIVED, _A.VERIFY_FALSE): _Transition(_R.DISPUTED, set(Role)),
    (_R.VERIFIED, _A.PAY): _Transition(_R.PAID, {Role.BURSAR}),
}


# (request type) -> (current status, action) -> transition
WORKFLOWS: dict[
    RequestType, dict[tuple[RequestStatus, WorkflowAction], _Transition]
] = {
    RequestType.BOOK: {
        (_R.PENDING_ACADEMIC, _A.APPROVE): _Transition(
            _R.PENDING_HEAD_MASTER, {Role.ACADEMIC_MASTER}
        ),
        (_R.PENDING_ACADEMIC, _A.REJECT): _Transition(
            _R.REJECTED, {Role.ACADEMIC_MASTER}
        ),
        (_R.PENDING_HEAD_MASTER, _A.APPROVE): _Transition(
            _R.APPROVED, {Role.HEAD_MASTER}
        ),
        (_R.PENDING_HEAD_MASTER, _A.REJECT): _Transition(
            _R.REJECTED, {Role.HEAD_MASTER}
        ),
        (_R.APPROVED, _A.REQUISITION): _Transition(
            _R.PENDING_BURSAR, {Role.LIBRARIAN}
        ),
        (_R.PAID, _A.SEND_TO_SCHOOL): _Transition(
            _R.SENT_TO_SCHOOL, {Role.STOREKEEPER}
        ),
        (_R.SENT_TO_SCHOOL, _A.CATALOGUE): _Transition(
            _R.CATALOGUED, {Role.LIBRARIAN}
        ),
        **_COMMON,
    },
    RequestType.OTHER: {
        (_R.PENDING_APPROVAL, _A.APPROVE): _Transition(
            _R.APPROVED, {Role.HEAD_MASTER, Role.ACADEMIC_MASTER}
        ),
        (_R.PENDING_APPROVAL, _A.REJECT): _Transition(
            _R.REJECTED, {Role.HEAD_MASTER, Role.ACADEMIC_MASTER}
        ),
        (_R.APPROVED, _A.REQUISITION): _Transition(
            _R.PENDING_BURSAR, {Role.LIBRARIAN}
        ),
        (_R.PAID, _A.MOVE_TO_STORE): _Transition(
            _R.IN_STORE, {Role.LIBRARIAN}
        ),
        **_COMMON,
    },
}


def initial_status(request_type: RequestType) -> RequestStatus:
    """Return the workflow entry status for ``request_type``."""
    if request_type is RequestType.BOOK:
        return RequestStatus.PENDING_ACADEMIC
    return RequestStatus.PENDING_APPROVAL


def apply_transition(
    *,
    request_type: RequestType,
    current_status: RequestStatus,
    action: WorkflowAction,
    roles: Iterable[Role],
) -> RequestStatus:
    """Validate a transition and return the resulting status.

    The action must be valid for the request type and current status (this
    rejects skipped steps), and the acting user must hold one of the roles
    allowed for that transition.

    Args:
        request_type: The workflow to use (BOOK or OTHER).
        current_status: The request's status before the action.
        action: The action being attempted.
        roles: Roles held by the acting user.

    Returns:
        The request's new status.

    Raises:
        HTTPException: 409 if the action is not valid for the current status
            (for example a skipped or already-completed step), or 403 if the
            actor lacks an allowed role. Callers may enforce additional
            identity-based rules (for example the requestor-only verify step).
    """
    transitions = WORKFLOWS.get(request_type)
    transition = (
        transitions.get((current_status, action)) if transitions else None
    )
    if transition is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Action {action.value} is not valid when a "
                f"{request_type.value} request is {current_status.value}"
            ),
        )

    if not (set(roles) & transition.allowed_roles):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not allowed to perform this transition",
        )

    return transition.next_status
