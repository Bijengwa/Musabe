"""Readable, unique code generation.

Book copy codes look like ``MUS-<BRANCHCODE>-<year>-<6 digit number>``, for
example ``MUS-GS-2026-000042``. The branch code is derived from the branch
name; the numeric suffix is allocated from the highest existing code for the
same branch and year so codes never repeat.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.library import BookCopy

_NON_ALNUM = re.compile(r"[^A-Za-z0-9]+")
CODE_PREFIX = "MUS"

# Highest sequence already handed out per prefix in this process. Codes are
# only visible in the database after the copy rows are committed, so relying on
# the database alone would re-issue the same suffix for codes generated within
# an uncommitted batch.
_ISSUED: dict[str, int] = {}


def branch_code(branch_name: str) -> str:
    """Return a short uppercase code derived from ``branch_name``.

    The initials of each word are used, e.g. ``"Nursery & Primary"`` becomes
    ``"NP"`` and ``"Girls Secondary"`` becomes ``"GS"``. Falls back to
    ``"GEN"`` when no letters or digits are present.
    """
    words = _NON_ALNUM.split(branch_name)
    initials = "".join(word[0] for word in words if word)
    return initials.upper()[:6] or "GEN"


def _next_sequence(db: Session, prefix: str) -> int:
    """Return the next numeric suffix to use for ``prefix``."""
    codes = db.scalars(
        select(BookCopy.code).where(BookCopy.code.like(f"{prefix}%"))
    ).all()
    highest = 0
    for code in codes:
        suffix = code.rsplit("-", 1)[-1]
        if suffix.isdigit():
            highest = max(highest, int(suffix))
    # Also respect codes handed out in this process but not yet committed.
    return max(highest, _ISSUED.get(prefix, 0)) + 1


def generate_copy_code(
    db: Session,
    branch_name: str,
    year: int | None = None,
    used: set[str] | None = None,
) -> str:
    """Return a new unique book-copy code.

    Uniqueness is guaranteed against both the database and any codes already
    allocated in the current batch via ``used`` (needed because the session
    does not autoflush).

    Args:
        db: Active database session.
        branch_name: Branch the copy belongs to (determines the branch code).
        year: Year segment; defaults to the current UTC year.
        used: Optional set of codes already allocated in this batch.

    Returns:
        A code that does not exist in the database nor in ``used``.
    """
    resolved_year = year or datetime.now(timezone.utc).year
    prefix = f"{CODE_PREFIX}-{branch_code(branch_name)}-{resolved_year}-"
    taken = used if used is not None else set()
    sequence = _next_sequence(db, prefix)
    while True:
        code = f"{prefix}{sequence:06d}"
        exists = db.scalar(select(BookCopy.id).where(BookCopy.code == code))
        if code not in taken and exists is None:
            taken.add(code)
            _ISSUED[prefix] = max(_ISSUED.get(prefix, 0), sequence)
            return code
        sequence += 1
