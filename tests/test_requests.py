"""Tests for the request and approval workflow (Phase 3)."""

from __future__ import annotations

from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.audit import AuditLog
from app.models.branch import Branch, BranchType
from app.models.request import Request, RequestStatus
from app.models.user import Role
from app.services import workflow
from app.services.workflow import WorkflowAction


def _make_branch(db: Session, name: str) -> Branch:
    """Create and persist a primary branch."""
    branch = Branch(name=name, type=BranchType.PRIMARY)
    db.add(branch)
    db.commit()
    db.refresh(branch)
    return branch


def _book_payload(**overrides) -> dict:
    """Return a valid BOOK request payload."""
    payload = {
        "type": "BOOK",
        "title": "New textbooks",
        "lines": [{"description": "Oxford Atlas", "quantity": 2}],
    }
    payload.update(overrides)
    return payload


def _create_book(
    client: TestClient, headers: dict[str, str], branch_id: int | None = None
) -> dict:
    """Create a BOOK request and return its JSON body."""
    response = client.post(
        "/requests", headers=headers, json=_book_payload(branch_id=branch_id)
    )
    assert response.status_code == 201, response.text
    return response.json()


# --------------------------------------------------------------------------- #
# Creation
# --------------------------------------------------------------------------- #
def test_create_book_request_starts_pending_academic(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """A BOOK request is created at PENDING_ACADEMIC for the requestor's branch."""
    branch = _make_branch(db_session, "Primary A")
    make_user(
        email="staff.a@example.com",
        roles=[Role.REQUESTING_STAFF],
        branch_ids=[branch.id],
    )
    headers = auth_headers("staff.a@example.com")

    body = _create_book(client, headers)
    assert body["status"] == "PENDING_ACADEMIC"
    assert body["type"] == "BOOK"
    assert body["branch_id"] == branch.id
    assert body["lines"][0]["description"] == "Oxford Atlas"
    assert body["approvals"] == []


def test_create_other_request_starts_pending_approval(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """An OTHER request is created at PENDING_APPROVAL."""
    branch = _make_branch(db_session, "Primary A")
    make_user(
        email="staff.a@example.com",
        roles=[Role.REQUESTING_STAFF],
        branch_ids=[branch.id],
    )
    headers = auth_headers("staff.a@example.com")

    response = client.post(
        "/requests",
        headers=headers,
        json={"type": "OTHER", "title": "Cleaning supplies"},
    )
    assert response.status_code == 201, response.text
    assert response.json()["status"] == "PENDING_APPROVAL"


def test_school_user_cannot_create_for_other_branch(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """A school-role user cannot raise a request against a foreign branch."""
    branch_a = _make_branch(db_session, "Primary A")
    branch_b = _make_branch(db_session, "Primary B")
    make_user(
        email="staff.a@example.com",
        roles=[Role.REQUESTING_STAFF],
        branch_ids=[branch_a.id],
    )
    headers = auth_headers("staff.a@example.com")

    response = client.post(
        "/requests", headers=headers, json=_book_payload(branch_id=branch_b.id)
    )
    assert response.status_code == 403


# --------------------------------------------------------------------------- #
# Approval flows
# --------------------------------------------------------------------------- #
def test_academic_then_head_master_approves_book(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """A BOOK request needs Academic Master then Head Master approval."""
    branch = _make_branch(db_session, "Primary A")
    make_user(
        email="staff.a@example.com",
        roles=[Role.REQUESTING_STAFF],
        branch_ids=[branch.id],
    )
    make_user(
        email="academic.a@example.com",
        roles=[Role.ACADEMIC_MASTER],
        branch_ids=[branch.id],
    )
    make_user(
        email="head.a@example.com",
        roles=[Role.HEAD_MASTER],
        branch_ids=[branch.id],
    )
    staff = auth_headers("staff.a@example.com")
    academic = auth_headers("academic.a@example.com")
    head = auth_headers("head.a@example.com")

    request_id = _create_book(client, staff)["id"]

    first = client.post(
        f"/requests/{request_id}/approve",
        headers=academic,
        json={"comment": "Academically sound"},
    )
    assert first.status_code == 200, first.text
    assert first.json()["status"] == "PENDING_HEAD_MASTER"

    second = client.post(f"/requests/{request_id}/approve", headers=head)
    assert second.status_code == 200, second.text
    body = second.json()
    assert body["status"] == "APPROVED"
    assert [a["action"] for a in body["approvals"]] == ["APPROVE", "APPROVE"]
    assert body["approvals"][0]["comment"] == "Academically sound"
    assert body["approvals"][0]["from_status"] == "PENDING_ACADEMIC"
    assert body["approvals"][0]["to_status"] == "PENDING_HEAD_MASTER"


def test_head_master_cannot_skip_academic_step(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """Approving a BOOK request with the Head Master first is blocked."""
    branch = _make_branch(db_session, "Primary A")
    make_user(
        email="staff.a@example.com",
        roles=[Role.REQUESTING_STAFF],
        branch_ids=[branch.id],
    )
    make_user(
        email="head.a@example.com",
        roles=[Role.HEAD_MASTER],
        branch_ids=[branch.id],
    )
    staff = auth_headers("staff.a@example.com")
    head = auth_headers("head.a@example.com")

    request_id = _create_book(client, staff)["id"]

    response = client.post(f"/requests/{request_id}/approve", headers=head)
    assert response.status_code == 403

    stored = db_session.get(Request, request_id)
    assert stored is not None
    assert stored.status == RequestStatus.PENDING_ACADEMIC


def test_wrong_role_cannot_approve(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """A user whose role is not part of the workflow cannot approve."""
    branch = _make_branch(db_session, "Primary A")
    make_user(
        email="staff.a@example.com",
        roles=[Role.REQUESTING_STAFF],
        branch_ids=[branch.id],
    )
    make_user(
        email="librarian.a@example.com",
        roles=[Role.LIBRARIAN],
        branch_ids=[branch.id],
    )
    staff = auth_headers("staff.a@example.com")
    librarian = auth_headers("librarian.a@example.com")

    request_id = _create_book(client, staff)["id"]

    response = client.post(f"/requests/{request_id}/approve", headers=librarian)
    assert response.status_code == 403


def test_other_request_approved_by_academic_or_head_master(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """An OTHER request may be approved by the Academic Master or Head Master."""
    branch = _make_branch(db_session, "Primary A")
    make_user(
        email="staff.a@example.com",
        roles=[Role.REQUESTING_STAFF],
        branch_ids=[branch.id],
    )
    make_user(
        email="academic.a@example.com",
        roles=[Role.ACADEMIC_MASTER],
        branch_ids=[branch.id],
    )
    make_user(
        email="head.a@example.com",
        roles=[Role.HEAD_MASTER],
        branch_ids=[branch.id],
    )
    staff = auth_headers("staff.a@example.com")
    academic = auth_headers("academic.a@example.com")
    head = auth_headers("head.a@example.com")

    first_id = client.post(
        "/requests", headers=staff, json={"type": "OTHER", "title": "Furniture"}
    ).json()["id"]
    academic_approved = client.post(
        f"/requests/{first_id}/approve", headers=academic
    )
    assert academic_approved.status_code == 200, academic_approved.text
    assert academic_approved.json()["status"] == "APPROVED"

    second_id = client.post(
        "/requests", headers=staff, json={"type": "OTHER", "title": "Stationery"}
    ).json()["id"]
    head_approved = client.post(f"/requests/{second_id}/approve", headers=head)
    assert head_approved.status_code == 200, head_approved.text
    assert head_approved.json()["status"] == "APPROVED"


# --------------------------------------------------------------------------- #
# Branch scoping
# --------------------------------------------------------------------------- #
def test_other_branch_cannot_see_or_list_request(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """A school-role user cannot see requests from another branch."""
    branch_a = _make_branch(db_session, "Primary A")
    branch_b = _make_branch(db_session, "Primary B")
    make_user(
        email="staff.a@example.com",
        roles=[Role.REQUESTING_STAFF],
        branch_ids=[branch_a.id],
    )
    make_user(
        email="head.b@example.com",
        roles=[Role.HEAD_MASTER],
        branch_ids=[branch_b.id],
    )
    staff = auth_headers("staff.a@example.com")
    head_b = auth_headers("head.b@example.com")

    request_id = _create_book(client, staff, branch_id=branch_a.id)["id"]

    assert client.get(f"/requests/{request_id}", headers=head_b).status_code == 404
    listed = client.get("/requests", headers=head_b)
    assert listed.status_code == 200
    assert listed.json() == []


def test_other_branch_cannot_approve(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """An approver in another branch cannot approve a pending request."""
    branch_a = _make_branch(db_session, "Primary A")
    branch_b = _make_branch(db_session, "Primary B")
    make_user(
        email="staff.a@example.com",
        roles=[Role.REQUESTING_STAFF],
        branch_ids=[branch_a.id],
    )
    make_user(
        email="academic.a@example.com",
        roles=[Role.ACADEMIC_MASTER],
        branch_ids=[branch_a.id],
    )
    make_user(
        email="head.b@example.com",
        roles=[Role.HEAD_MASTER],
        branch_ids=[branch_b.id],
    )
    staff = auth_headers("staff.a@example.com")
    academic = auth_headers("academic.a@example.com")
    head_b = auth_headers("head.b@example.com")

    request_id = _create_book(client, staff)["id"]
    assert (
        client.post(
            f"/requests/{request_id}/approve", headers=academic
        ).status_code
        == 200
    )

    blocked = client.post(f"/requests/{request_id}/approve", headers=head_b)
    assert blocked.status_code == 404


def test_central_role_sees_all_requests(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """A central-role user sees requests from every branch."""
    branch_a = _make_branch(db_session, "Primary A")
    branch_b = _make_branch(db_session, "Primary B")
    make_user(
        email="staff.a@example.com",
        roles=[Role.REQUESTING_STAFF],
        branch_ids=[branch_a.id],
    )
    make_user(
        email="staff.b@example.com",
        roles=[Role.REQUESTING_STAFF],
        branch_ids=[branch_b.id],
    )
    make_user(
        email="manager@example.com",
        roles=[Role.MANAGER],
        branch_ids=[None],
    )
    _create_book(client, auth_headers("staff.a@example.com"))
    client.post(
        "/requests",
        headers=auth_headers("staff.b@example.com"),
        json={"type": "OTHER", "title": "Pens"},
    )

    listed = client.get("/requests", headers=auth_headers("manager@example.com"))
    assert listed.status_code == 200
    assert len(listed.json()) == 2


# --------------------------------------------------------------------------- #
# Rejection and audit trail
# --------------------------------------------------------------------------- #
def test_reject_ends_flow(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """Rejecting ends the workflow; no further transitions are possible."""
    branch = _make_branch(db_session, "Primary A")
    make_user(
        email="staff.a@example.com",
        roles=[Role.REQUESTING_STAFF],
        branch_ids=[branch.id],
    )
    make_user(
        email="academic.a@example.com",
        roles=[Role.ACADEMIC_MASTER],
        branch_ids=[branch.id],
    )
    staff = auth_headers("staff.a@example.com")
    academic = auth_headers("academic.a@example.com")

    request_id = _create_book(client, staff)["id"]

    rejected = client.post(
        f"/requests/{request_id}/reject",
        headers=academic,
        json={"comment": "Not in the syllabus"},
    )
    assert rejected.status_code == 200, rejected.text
    body = rejected.json()
    assert body["status"] == "REJECTED"
    assert body["approvals"][-1]["action"] == "REJECT"
    assert body["approvals"][-1]["comment"] == "Not in the syllabus"

    again = client.post(f"/requests/{request_id}/approve", headers=academic)
    assert again.status_code == 409


def test_every_transition_writes_audit_row(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """Creation and each approval/rejection append to the audit log."""
    branch = _make_branch(db_session, "Primary A")
    make_user(
        email="staff.a@example.com",
        roles=[Role.REQUESTING_STAFF],
        branch_ids=[branch.id],
    )
    make_user(
        email="academic.a@example.com",
        roles=[Role.ACADEMIC_MASTER],
        branch_ids=[branch.id],
    )
    make_user(
        email="head.a@example.com",
        roles=[Role.HEAD_MASTER],
        branch_ids=[branch.id],
    )
    staff = auth_headers("staff.a@example.com")
    academic = auth_headers("academic.a@example.com")
    head = auth_headers("head.a@example.com")

    request_id = _create_book(client, staff)["id"]
    client.post(f"/requests/{request_id}/approve", headers=academic)
    client.post(f"/requests/{request_id}/approve", headers=head)

    rows = list(
        db_session.scalars(
            select(AuditLog)
            .where(AuditLog.request_id == request_id)
            .order_by(AuditLog.id)
        ).all()
    )
    assert [row.action for row in rows] == ["CREATE", "APPROVE", "APPROVE"]
    assert rows[0].from_status is None
    assert rows[0].to_status == "PENDING_ACADEMIC"
    assert rows[1].from_status == "PENDING_ACADEMIC"
    assert rows[1].to_status == "PENDING_HEAD_MASTER"
    assert rows[2].from_status == "PENDING_HEAD_MASTER"
    assert rows[2].to_status == "APPROVED"


def test_rejection_writes_audit_row(
    client: TestClient, db_session: Session, make_user, auth_headers
) -> None:
    """A rejection is recorded in the audit log with the actor and comment."""
    branch = _make_branch(db_session, "Primary A")
    staff_user = make_user(
        email="staff.a@example.com",
        roles=[Role.REQUESTING_STAFF],
        branch_ids=[branch.id],
    )
    make_user(
        email="head.a@example.com",
        roles=[Role.HEAD_MASTER],
        branch_ids=[branch.id],
    )
    staff = auth_headers("staff.a@example.com")
    head = auth_headers("head.a@example.com")

    request_id = client.post(
        "/requests", headers=staff, json={"type": "OTHER", "title": "Chairs"}
    ).json()["id"]
    client.post(
        f"/requests/{request_id}/reject", headers=head, json={"comment": "No budget"}
    )

    rows = list(
        db_session.scalars(
            select(AuditLog).where(AuditLog.request_id == request_id)
        ).all()
    )
    assert len(rows) == 2
    rejection = rows[-1]
    assert rejection.action == "REJECT"
    assert rejection.from_status == "PENDING_APPROVAL"
    assert rejection.to_status == "REJECTED"
    assert rejection.detail == "No budget"
    assert rejection.actor_id != staff_user.id


# --------------------------------------------------------------------------- #
# Workflow unit test
# --------------------------------------------------------------------------- #
def test_apply_transition_rules() -> None:
    """``apply_transition`` encodes the documented edges and rejects others."""
    from fastapi import HTTPException

    assert workflow.initial_status(workflow.RequestType.BOOK) == (
        RequestStatus.PENDING_ACADEMIC
    )
    assert workflow.initial_status(workflow.RequestType.OTHER) == (
        RequestStatus.PENDING_APPROVAL
    )

    assert workflow.apply_transition(
        request_type=workflow.RequestType.BOOK,
        current_status=RequestStatus.PENDING_ACADEMIC,
        action=WorkflowAction.APPROVE,
        roles={Role.ACADEMIC_MASTER},
    ) == RequestStatus.PENDING_HEAD_MASTER

    for roles in ({Role.HEAD_MASTER}, {Role.REQUESTING_STAFF}):
        try:
            workflow.apply_transition(
                request_type=workflow.RequestType.BOOK,
                current_status=RequestStatus.PENDING_ACADEMIC,
                action=WorkflowAction.APPROVE,
                roles=roles,
            )
        except HTTPException as exc:
            assert exc.status_code == 403
        else:  # pragma: no cover - defensive
            raise AssertionError("expected permission failure")

    try:
        workflow.apply_transition(
            request_type=workflow.RequestType.BOOK,
            current_status=RequestStatus.APPROVED,
            action=WorkflowAction.APPROVE,
            roles={Role.HEAD_MASTER},
        )
    except HTTPException as exc:
        assert exc.status_code == 409
    else:  # pragma: no cover - defensive
        raise AssertionError("expected invalid-transition failure")
