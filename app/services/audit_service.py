"""Audit service: record state changes in the audit log."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.audit import AuditLog


def log_action(
    db: Session,
    *,
    action: str,
    request_id: int | None = None,
    actor_id: int | None = None,
    from_status: str | None = None,
    to_status: str | None = None,
    detail: str | None = None,
) -> AuditLog:
    """Write an ``audit_logs`` row and return it.

    The row is added and flushed to the session but not committed; the caller
    commits so the audit entry shares the transaction with the state change.

    Args:
        db: Active database session.
        action: Short action label, e.g. ``"CREATE"``, ``"APPROVE"``.
        request_id: The request whose state changed, if any.
        actor_id: The user who performed the action, if any.
        from_status: Status before the change, if applicable.
        to_status: Status after the change, if applicable.
        detail: Optional free-text detail (e.g. an approval comment).
    """
    entry = AuditLog(
        request_id=request_id,
        actor_id=actor_id,
        action=action,
        from_status=from_status,
        to_status=to_status,
        detail=detail,
    )
    db.add(entry)
    db.flush()
    return entry
