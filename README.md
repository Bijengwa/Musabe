# Musabe Schools Management System — Backend

A REST API for managing a group of schools: staff and branch administration,
requests and approvals, procurement, the library and the store, issuing,
write-offs, parent contributions, and management reports.

Built with **Python + FastAPI**, **SQLAlchemy 2**, **Alembic**, and
**Pydantic v2**. The development database is SQLite; production targets
PostgreSQL. All business rules live in services; routers only translate HTTP
to service calls.

---

## Features

| Phase | Area | What it does |
| ----- | ---- | ------------ |
| 1 | Setup | App skeleton, config, database connection, Alembic, `/health` |
| 2 | Auth + Admin | JWT auth, branches, staff users, role assignments |
| 3 | Requests + Approvals | BOOK/OTHER workflows, approval history, audit log |
| 4 | Procurement | Requisition, purchase order, order, receive, verify, pay |
| 5 | Library + Inventory | Book titles/copies with unique codes, stock + movements |
| 6 | Issuing, Write-off, Contributions | Lend/return book copies and stock; write off lost/damaged copies; record parent contributions |
| 7 | Reports | Live dashboard: pending requests, stock, outstanding loans, spend, activity |

Every state change is written to an `audit_logs` row. School roles only ever
see their own branch's data; central roles see everything.

---

## Roles

**Central (all branches):** `ADMIN`, `MANAGER`, `BURSAR`, `STOREKEEPER`

**School (own branch):** `HEAD_MASTER`, `ACADEMIC_MASTER`, `LIBRARIAN`, `REQUESTING_STAFF`

Key rules: only a **Librarian** issues items and catalogues books; only a
**Head Master** approves write-offs; a **Bursar** raises purchase orders and
pays; a **Storekeeper** orders, receives, and dispatches; the original
**Requestor** verifies a delivery.

---

## Getting started

Requires **Python 3.11+** (developed on 3.14).

```bash
git clone https://github.com/<your-username>/musabe-backend.git
cd musabe-backend

python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env          # tweak values if needed
python -m alembic upgrade head # create the database schema
python -m scripts.seed         # create branches, demo staff, and a supplier

python -m uvicorn app.main:app --reload
```

Then open:

- Interactive API docs (Swagger UI): <http://127.0.0.1:8000/docs>
- Alternative docs (ReDoc): <http://127.0.0.1:8000/redoc>
- Health check: <http://127.0.0.1:8000/health>

> **Note:** run Alembic and scripts as modules (`python -m alembic ...`,
> `python -m scripts.seed`) so package imports resolve correctly.

---

## Demo

Two ways to see it working.

**1. Fully automated walkthrough (no server needed).** This builds a temporary
database, seeds it, and drives the real app through both purchase flows,
issuing, write-off, and contributions — asserting every step:

```bash
python -m scripts.demo
```

Expected output ends with `DEMO PASSED: 27 steps executed successfully.`

**2. Manual walkthrough against a running server.** See
[`docs/DEMO.md`](docs/DEMO.md) for a click-by-click guide and sample accounts.

### Demo accounts (created by `scripts.seed`)

| Role | Email | Password |
| ---- | ----- | -------- |
| Admin (central) | `admin@musabe.ac.ug` | `admin12345` |
| Manager (central) | `manager@musabe.ac.ug` | `musabe12345` |
| Bursar (central) | `bursar@musabe.ac.ug` | `musabe12345` |
| Storekeeper (central) | `storekeeper@musabe.ac.ug` | `musabe12345` |
| Head Master | `head.nursery-primary@musabe.ac.ug` | `musabe12345` |
| Academic Master | `academic.nursery-primary@musabe.ac.ug` | `musabe12345` |
| Librarian | `librarian.nursery-primary@musabe.ac.ug` | `musabe12345` |
| Requesting Staff | `staff.nursery-primary@musabe.ac.ug` | `musabe12345` |

School accounts also exist for `girls-secondary` and `boys-secondary`
(e.g. `head.girls-secondary@musabe.ac.ug`).

> These are demo credentials for local development only. Change the JWT secret
> and passwords before any real deployment.

---

## Testing

```bash
python -m pytest -q          # whole suite
python -m pytest tests/test_end_to_end.py -q   # full pipeline only
```

The suite uses an in-memory SQLite database, so it needs no setup and never
touches `dev.db`.

---

## API overview

All endpoints except `/health` and `/auth/login` require a bearer token:
`Authorization: Bearer <access_token>`.

| Method | Path | Purpose | Who |
| ------ | ---- | ------- | --- |
| POST | `/auth/login` | Get access + refresh tokens | anyone |
| POST | `/auth/refresh` | Exchange a refresh token | anyone |
| GET | `/auth/me` | Current user + roles | any user |
| GET/POST | `/admin/branches` | List / create branches | admin |
| GET/POST | `/admin/staff` | List / create staff | admin |
| PATCH | `/admin/staff/{id}` | Update role/branches/active | admin |
| GET/POST | `/requests` | List / create requests | authenticated |
| GET | `/requests/{id}` | Get one request | authenticated |
| POST | `/requests/{id}/approve` | Approve current step | see workflow |
| POST | `/requests/{id}/reject` | Reject request | see workflow |
| GET/POST | `/suppliers` | List / create suppliers | admin, bursar |
| POST | `/requests/{id}/requisition` | Raise requisition | librarian |
| POST | `/requests/{id}/purchase-order` | Create purchase order | bursar |
| POST | `/requests/{id}/manager-approval` | Approve/reject PO | manager |
| POST | `/requests/{id}/order` | Place order | storekeeper |
| POST | `/requests/{id}/receive` | Receive delivery | storekeeper |
| POST | `/requests/{id}/verify` | Verify delivery | original requestor |
| POST | `/requests/{id}/pay` | Record payment | bursar |
| POST | `/requests/{id}/send-to-school` | Dispatch BOOK books | storekeeper |
| POST | `/requests/{id}/move-to-store` | Move OTHER goods to store | librarian |
| POST | `/library/catalogue` | Catalogue a BOOK request | librarian |
| GET | `/library/books` | List book copies | authenticated |
| GET | `/library/books/{code}` | Get a copy by code | authenticated |
| GET | `/inventory` | Stock levels | authenticated |
| GET/POST | `/issues` | List / create issues | librarian (create) |
| POST | `/issues/{id}/return` | Return an issue | librarian |
| GET/POST | `/write-offs` | List / report write-offs | librarian (create) |
| POST | `/write-offs/{id}/approve` | Approve/reject write-off | head master |
| GET/POST | `/contributions` | List / record contributions | librarian (create) |
| GET | `/reports/overview` | Dashboard summary | authenticated |
| GET | `/reports/pending-requests` | Non-terminal requests | authenticated |
| GET | `/reports/stock` | Stock levels (low-stock flag) | authenticated |
| GET | `/reports/outstanding-issues` | Unreturned loans | authenticated |
| GET | `/reports/spend` | Ordered/paid totals per branch | authenticated |
| GET | `/reports/activity` | Recent audit trail | authenticated |
| GET | `/health` | Liveness probe | anyone |

List endpoints that return branch data accept an optional `?branch_id=`
filter; school roles are always scoped to their own branches.

---

## Request workflows

**BOOK** (textbook/library purchases):

```
PENDING_ACADEMIC → PENDING_HEAD_MASTER → APPROVED → PENDING_BURSAR
→ PENDING_MANAGER → PENDING_ORDER → ORDERED → RECEIVED → VERIFIED → PAID
→ SENT_TO_SCHOOL → CATALOGUED
```

**OTHER** (consumables and general items):

```
PENDING_APPROVAL → PENDING_BURSAR → PENDING_MANAGER → PENDING_ORDER
→ ORDERED → RECEIVED → VERIFIED → PAID → IN_STORE
```

A failed verification (`matched=false`) moves a request to `DISPUTED`;
`REJECTED` is terminal for either flow. The single source of truth for these
transitions is [`app/services/workflow.py`](app/services/workflow.py).

---

## Project structure

```
app/
  main.py              FastAPI app + router registration
  core/                config, database, security (hashing/JWT), permissions
  models/              SQLAlchemy models (one concern per file)
  schemas/             Pydantic request/response models
  routers/             thin HTTP layer
  services/            business logic (workflow, procurement, library,
                       issuing, write-off, reports, audit, ...)
  utils/codes.py       unique code generation (book copies, etc.)
alembic/               migration environment + versioned migrations
scripts/               seed.py (demo data), demo.py (automated walkthrough)
tests/                 pytest suite (incl. end-to-end pipeline tests)
docs/                  SPEC.md, DEMO.md
```

---

## Database & migrations

The schema is defined by the SQLAlchemy models and applied with Alembic.

```bash
python -m alembic upgrade head          # apply all migrations
python -m alembic revision --autogenerate -m "describe change"
python -m alembic current               # show the current revision
```

Migrations under `alembic/versions/` are committed to Git on purpose — anyone
who clones the repo must be able to build the same schema. The local SQLite
database file (`dev.db`) and `.env` are ignored.

For PostgreSQL, set `DATABASE_URL` in `.env`, for example:

```
DATABASE_URL=postgresql+psycopg://user:password@localhost:5432/musabe
```

---

## Working with collaborators

- **Backend** lives in this repository (models, migrations, and API).
- **Frontend** should be a separate repository/app that talks to this API
  using the OpenAPI schema at `/openapi.json` (or `/docs`). Generate typed
  clients directly from that schema if you like.
- **Database schema ownership:** models and migrations are defined here, so
  schema changes should land here. Coordinate before editing the schema from
  elsewhere to avoid drift.

See [`docs/DEMO.md`](docs/DEMO.md) for the manual demo, and the pushed
`README` for how to invite collaborators on GitHub.
