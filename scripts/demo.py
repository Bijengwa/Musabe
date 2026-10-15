"""Run a full end-to-end demonstration of the Musabe backend.

This script is self-contained: it builds a temporary SQLite database, seeds the
demo data, and drives the real FastAPI app through the complete BOOK purchase
flow, the OTHER purchase flow, issuing, write-off, and parent contributions.
Every step is asserted, so a clean run proves the system works end to end.

Usage:
    python -m scripts.demo
"""

from __future__ import annotations

from decimal import Decimal

from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401  (register models on Base.metadata)
from app.core.database import Base, get_db
from app.main import app
from app.models.branch import Branch
from app.models.procurement import Supplier
from scripts.seed import (
    ADMIN_EMAIL,
    ADMIN_PASSWORD,
    DEMO_PASSWORD,
    seed,
)

BRANCH_NAME = "Nursery & Primary"
SLUG = "nursery-primary"

STAFF = f"staff.{SLUG}@musabe.ac.ug"
ACADEMIC = f"academic.{SLUG}@musabe.ac.ug"
HEAD = f"head.{SLUG}@musabe.ac.ug"
LIBRARIAN = f"librarian.{SLUG}@musabe.ac.ug"
MANAGER = "manager@musabe.ac.ug"
BURSAR = "bursar@musabe.ac.ug"
STOREKEEPER = "storekeeper@musabe.ac.ug"


class Demo:
    """Collects a session, client, and helper methods for the walkthrough."""

    def __init__(self) -> None:
        engine = create_engine(
            "sqlite+pysqlite:///:memory:",
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
        Base.metadata.create_all(engine)
        self.session = sessionmaker(
            bind=engine, autoflush=False, expire_on_commit=False
        )()
        seed(self.session, verbose=False)

        def override_get_db():
            yield self.session

        app.dependency_overrides[get_db] = override_get_db
        self.client = TestClient(app)
        self.headers: dict[str, dict[str, str]] = {}
        self.passed = 0

    def login(self, email: str, password: str = DEMO_PASSWORD) -> None:
        """Log in and store the bearer header under ``email``."""
        response = self.client.post(
            "/auth/login", json={"email": email, "password": password}
        )
        assert response.status_code == 200, response.text
        token = response.json()["access_token"]
        self.headers[email] = {"Authorization": f"Bearer {token}"}

    def step(self, label: str, response, expected: int = 200) -> dict:
        """Assert a response status, print it, and return the JSON body."""
        marker = "ok" if response.status_code == expected else "FAIL"
        print(f"  [{marker} {response.status_code}] {label}")
        assert response.status_code == expected, response.text
        self.passed += 1
        return response.json()

    def close(self) -> None:
        """Clear dependency overrides."""
        app.dependency_overrides.clear()


def _walk_book_flow(demo: Demo) -> None:
    """Drive a BOOK request all the way to catalogued, issued, and written off."""
    print("\nBOOK flow: request -> approvals -> procurement -> library")
    c, h = demo.client, demo.headers

    created = demo.step(
        "Requesting staff creates a BOOK request",
        c.post(
            "/requests",
            headers=h[STAFF],
            json={
                "type": "BOOK",
                "title": "Grade 1 Mathematics",
                "lines": [
                    {
                        "description": "Grade 1 Mathematics Pupil Book",
                        "quantity": 2,
                        "unit": "copy",
                    }
                ],
            },
        ),
        201,
    )
    request_id = created["id"]
    assert created["status"] == "PENDING_ACADEMIC"

    body = demo.step(
        "Academic Master approves",
        c.post(
            f"/requests/{request_id}/approve",
            headers=h[ACADEMIC],
            json={"comment": "Recommended"},
        ),
    )
    assert body["status"] == "PENDING_HEAD_MASTER"

    body = demo.step(
        "Head Master approves",
        c.post(f"/requests/{request_id}/approve", headers=h[HEAD], json={}),
    )
    assert body["status"] == "APPROVED"

    body = demo.step(
        "Librarian raises a requisition",
        c.post(
            f"/requests/{request_id}/requisition",
            headers=h[LIBRARIAN],
            json={"notes": "Term 1 books"},
        ),
    )
    assert body["status"] == "PENDING_BURSAR"

    supplier_id = c.get("/suppliers", headers=h[BURSAR]).json()[0]["id"]
    body = demo.step(
        "Bursar creates a purchase order",
        c.post(
            f"/requests/{request_id}/purchase-order",
            headers=h[BURSAR],
            json={"supplier_id": supplier_id, "total_amount": "250000.00"},
        ),
    )
    assert body["status"] == "PENDING_MANAGER"

    body = demo.step(
        "Manager approves the purchase order",
        c.post(
            f"/requests/{request_id}/manager-approval",
            headers=h[MANAGER],
            json={"approve": True, "comment": "Within budget"},
        ),
    )
    assert body["status"] == "PENDING_ORDER"

    body = demo.step(
        "Storekeeper places the order",
        c.post(f"/requests/{request_id}/order", headers=h[STOREKEEPER]),
    )
    assert body["status"] == "ORDERED"

    body = demo.step(
        "Storekeeper receives the delivery",
        c.post(
            f"/requests/{request_id}/receive",
            headers=h[STOREKEEPER],
            json={"delivery_note": "Delivered in full"},
        ),
    )
    assert body["status"] == "RECEIVED"

    body = demo.step(
        "Requesting staff verifies the delivery",
        c.post(
            f"/requests/{request_id}/verify",
            headers=h[STAFF],
            json={"matched": True, "note": "All copies present"},
        ),
    )
    assert body["status"] == "VERIFIED"

    body = demo.step(
        "Bursar records payment",
        c.post(f"/requests/{request_id}/pay", headers=h[BURSAR], json={}),
    )
    assert body["status"] == "PAID"

    body = demo.step(
        "Storekeeper sends the books to school",
        c.post(f"/requests/{request_id}/send-to-school", headers=h[STOREKEEPER]),
    )
    assert body["status"] == "SENT_TO_SCHOOL"

    body = demo.step(
        "Librarian catalogues the books",
        c.post(
            "/library/catalogue",
            headers=h[LIBRARIAN],
            json={"request_id": request_id},
        ),
    )
    assert body["status"] == "CATALOGUED"

    books = c.get("/library/books", headers=h[LIBRARIAN]).json()
    assert len(books) == 2, books
    issue_code, writeoff_code = books[0]["code"], books[1]["code"]

    issue = demo.step(
        "Librarian issues a book copy",
        c.post(
            "/issues",
            headers=h[LIBRARIAN],
            json={"borrower": "Pupil Aisha", "book_code": issue_code},
        ),
        201,
    )
    assert issue["status"] == "ISSUED"

    body = demo.step(
        "Librarian returns the book copy",
        c.post(f"/issues/{issue['id']}/return", headers=h[LIBRARIAN]),
    )
    assert body["status"] == "RETURNED"

    writeoff = demo.step(
        "Librarian reports a damaged copy",
        c.post(
            "/write-offs",
            headers=h[LIBRARIAN],
            json={"book_code": writeoff_code, "reason": "DAMAGED"},
        ),
        201,
    )
    assert writeoff["status"] == "PENDING"

    body = demo.step(
        "Head Master approves the write-off",
        c.post(
            f"/write-offs/{writeoff['id']}/approve",
            headers=h[HEAD],
            json={"approve": True, "note": "Confirmed damaged"},
        ),
    )
    assert body["status"] == "APPROVED"

    body = demo.step(
        "Librarian records a parent contribution",
        c.post(
            "/contributions",
            headers=h[LIBRARIAN],
            json={
                "item_name": "Reams of paper",
                "quantity": 10,
                "contributor": "Parent Aisha",
            },
        ),
        201,
    )
    assert body["quantity"] == 10


def _walk_other_flow(demo: Demo) -> None:
    """Drive an OTHER request to IN_STORE."""
    print("\nOTHER flow: request -> approvals -> procurement -> store")
    c, h = demo.client, demo.headers

    created = demo.step(
        "Requesting staff creates an OTHER request",
        c.post(
            "/requests",
            headers=h[STAFF],
            json={
                "type": "OTHER",
                "title": "Classroom chalk",
                "lines": [{"description": "Boxes of chalk", "quantity": 20}],
            },
        ),
        201,
    )
    request_id = created["id"]
    assert created["status"] == "PENDING_APPROVAL"

    body = demo.step(
        "Head Master approves",
        c.post(f"/requests/{request_id}/approve", headers=h[HEAD], json={}),
    )
    assert body["status"] == "PENDING_BURSAR"

    supplier_id = c.get("/suppliers", headers=h[BURSAR]).json()[0]["id"]
    body = demo.step(
        "Bursar creates a purchase order",
        c.post(
            f"/requests/{request_id}/purchase-order",
            headers=h[BURSAR],
            json={"supplier_id": supplier_id, "total_amount": "80000.00"},
        ),
    )
    assert body["status"] == "PENDING_MANAGER"

    demo.step(
        "Manager approves",
        c.post(
            f"/requests/{request_id}/manager-approval",
            headers=h[MANAGER],
            json={"approve": True},
        ),
    )
    demo.step(
        "Storekeeper orders and receives",
        c.post(f"/requests/{request_id}/order", headers=h[STOREKEEPER]),
    )
    demo.step(
        "Storekeeper receives",
        c.post(f"/requests/{request_id}/receive", headers=h[STOREKEEPER]),
    )
    body = demo.step(
        "Requesting staff verifies",
        c.post(
            f"/requests/{request_id}/verify",
            headers=h[STAFF],
            json={"matched": True},
        ),
    )
    assert body["status"] == "VERIFIED"

    demo.step(
        "Bursar pays",
        c.post(f"/requests/{request_id}/pay", headers=h[BURSAR], json={}),
    )
    body = demo.step(
        "Librarian moves goods into the store",
        c.post(f"/requests/{request_id}/move-to-store", headers=h[LIBRARIAN]),
    )
    assert body["status"] == "IN_STORE"


def _show_reports(demo: Demo) -> None:
    """Print the management report overview."""
    print("\nReports: management overview")
    c, h = demo.client, demo.headers
    overview = demo.step(
        "Manager views the dashboard",
        c.get("/reports/overview", headers=h[MANAGER]),
    )
    print(f"    requests={overview['total_requests']} "
          f"pending={overview['pending_requests']} "
          f"books={overview['total_book_copies']} "
          f"stock={overview['stock_items']} (low={overview['low_stock_items']}) "
          f"outstanding={overview['outstanding_issues']} "
          f"ordered={Decimal(str(overview['total_ordered']))} "
          f"paid={Decimal(str(overview['total_paid']))}")


def main() -> None:
    """Run the whole demonstration."""
    demo = Demo()
    print("Musabe Schools Management System - end-to-end demo")
    print("=" * 55)
    for email, password in (
        (STAFF, DEMO_PASSWORD),
        (ACADEMIC, DEMO_PASSWORD),
        (HEAD, DEMO_PASSWORD),
        (LIBRARIAN, DEMO_PASSWORD),
        (MANAGER, DEMO_PASSWORD),
        (BURSAR, DEMO_PASSWORD),
        (STOREKEEPER, DEMO_PASSWORD),
        (ADMIN_EMAIL, ADMIN_PASSWORD),
    ):
        demo.login(email, password)
    print("Logged in all demo accounts.")

    try:
        _walk_book_flow(demo)
        _walk_other_flow(demo)
        _show_reports(demo)
    finally:
        demo.close()

    print("=" * 55)
    print(f"DEMO PASSED: {demo.passed} steps executed successfully.")


if __name__ == "__main__":
    main()
