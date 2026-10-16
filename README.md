# Musabe Schools Management System

A school-management system for a group of schools: staff and branch
administration, requests and approvals, procurement, the library and the store,
issuing, write-offs, parent contributions, and management reports.

The repository holds two parts that run together:

- **Backend** — a REST API + the website server (`app/`, Python + FastAPI).
- **Frontend** — a static, no-build web app (`frontend/`, HTML/CSS/JavaScript)
  served by the backend at `/`.

---

## Tech stack

| Layer | Technology |
| ----- | ---------- |
| Language (backend) | **Python 3.11+** (tested on 3.14) |
| Web framework | **FastAPI** + **Uvicorn** |
| Validation | **Pydantic v2** |
| ORM | **SQLAlchemy 2.0** |
| Migrations | **Alembic** |
| Database | **PostgreSQL** (production) / **SQLite** (local dev, tests) |
| Auth | **JWT** (PyJWT) + **bcrypt** password hashing |
| Tests | **pytest** + **httpx** (TestClient) |
| Frontend | **HTML + CSS + vanilla JavaScript** (no build step) |
| Packaging / runtime | **Docker** + **Docker Compose** |

Architecture is `router → service → model`: routers only translate HTTP,
all business rules live in services, and every state change writes an
`audit_logs` row. The single source of truth for workflow transitions is
[`app/services/workflow.py`](app/services/workflow.py).

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

### Option A — Docker Compose (recommended, PostgreSQL)

The supported way to run the full system (PostgreSQL + API + website).

```bash
git clone https://github.com/Bijengwa/Musabe.git
cd Musabe

cp .env.example .env          # then edit POSTGRES_PASSWORD and JWT_SECRET_KEY

docker compose up --build -d  # starts PostgreSQL and the web application
docker compose run --rm backend python -m scripts.seed   # optional demo data
```

### Option B — Local Python with SQLite (no Docker, no PostgreSQL)

Fastest way to run it on a laptop. Uses the bundled SQLite file.

```bash
git clone https://github.com/Bijengwa/Musabe.git
cd Musabe

python -m venv .venv
source .venv/bin/activate          # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# Point the app at SQLite
echo "DATABASE_URL=sqlite+pysqlite:///./dev.db" >> .env

python -m alembic upgrade head     # create the schema
python -m scripts.seed             # load demo schools, staff and books

uvicorn app.main:app --reload      # start the API + website
```

Then open:

- **Web application:** <http://127.0.0.1:8000/>
- Interactive API docs (Swagger UI): <http://127.0.0.1:8000/docs>
- Alternative docs (ReDoc): <http://127.0.0.1:8000/redoc>
- Health check: <http://127.0.0.1:8000/health>

The web application is a responsive HTML/CSS/JavaScript site served by the
backend at `/`; no separate build step or dev server is required.

With Docker, data is stored in the `pgdata` volume and survives restarts. To
stop without losing data: `docker compose down` (add `-v` **only** if you
intend to delete the database).

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

Expected output ends with `DEMO PASSED: 28 steps executed successfully.`

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
| GET | `/reports/my-actions` | Pending tasks for the current user's roles | authenticated |
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
PENDING_APPROVAL → APPROVED → PENDING_BURSAR → PENDING_MANAGER
→ PENDING_ORDER → ORDERED → RECEIVED → VERIFIED → PAID → IN_STORE
```

An OTHER request is approved by the **Academic Master or Head Master**,
after which a **Librarian** raises the requisition that forwards it to the
Bursar — the same librarian hand-off BOOKs go through.

A failed verification (`matched=false`) moves a request to `DISPUTED`;
`REJECTED` is terminal for either flow. The single source of truth for these
transitions is [`app/services/workflow.py`](app/services/workflow.py).

---

## Project structure

```
Musabe/
├── app/                       Backend application (Python / FastAPI)
│   ├── main.py                FastAPI app + router registration, serves frontend/
│   ├── core/                  config.py, database.py, security.py, permissions.py
│   ├── models/                SQLAlchemy models (one concern per file)
│   ├── schemas/               Pydantic request/response models
│   ├── routers/               thin HTTP layer (one router per feature)
│   ├── services/              business logic — the heart of the system
│   │   ├── workflow.py        every request status transition (BOOK & OTHER)
│   │   ├── request_service.py create/approve/reject requests, branch scoping
│   │   ├── procurement_service.py  requisition → PO → order → receive → pay
│   │   ├── inventory_service.py    stock levels + stock movements
│   │   ├── issuing_service.py      lend/return book copies and stock
│   │   ├── writeoff_service.py     lost/damaged copies + Head Master approval
│   │   ├── reports_service.py      dashboard aggregations + "my actions"
│   │   └── audit_service.py        writes every state change to audit_logs
│   └── utils/codes.py        unique code generation (book copy codes, etc.)
│
├── frontend/                  Static web app (no build step) served at /
│   ├── index.html             single-page shell (login + app views)
│   ├── css/style.css          styling
│   └── js/
│       ├── api.js             fetch wrapper, token storage, session/roles
│       ├── app.js             login, hash router, sidebar navigation
│       ├── ui.js              DOM helpers, badges, tables, modals
│       └── pages/             one module per screen
│           ├── dashboard.js   overview + role-aware "Awaiting your action"
│           ├── requests.js    request list + workflow action buttons
│           ├── library.js     book titles, copies, catalogue
│           ├── issuing.js     lend / return
│           ├── inventory.js   stock levels and movements
│           ├── writeoffs.js   lost/damaged reports + approval
│           ├── contributions.js  parent contributions
│           ├── suppliers.js   supplier directory
│           └── admin.js       branches & staff administration
│
├── alembic/                   Migrations (env.py + versioned revisions)
├── scripts/
│   ├── seed.py                demo schools, staff, books and suppliers
│   ├── demo.py                fully automated end-to-end walkthrough
│   ├── backup_database.sh     dump the database
│   └── restore_database.sh    restore from a dump
├── tests/                     pytest suite (unit + end-to-end pipeline)
├── docs/                      SPEC.md, DEMO.md, INSTALLATION.md, DATABASE_BACKUP.md
├── compose.yaml               PostgreSQL + backend containers
├── Dockerfile                 backend image
├── requirements.txt           pinned Python dependencies
└── alembic.ini                Alembic configuration
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

PostgreSQL is the primary database. The connection URL is assembled from the
`POSTGRES_*` variables in `.env`:

```
POSTGRES_USER=musabe
POSTGRES_PASSWORD=change-me
POSTGRES_DB=musabe
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
```

Setting an explicit `DATABASE_URL` overrides them (useful for tests or for a
temporary SQLite database with `sqlite+pysqlite:///./dev.db`).

---

## Working with collaborators

- **Backend** lives in `app/` (models, migrations, and API).
- **Frontend** is the static website in `frontend/`, served by the backend at
  `/` and talking to the same origin's API. It has no build step; edit the
  HTML/CSS/JS and refresh. Generate typed clients from `/openapi.json` if you
  prefer.
- **Database schema ownership:** models and migrations are defined here, so
  schema changes should land here. Coordinate before editing the schema from
  elsewhere to avoid drift.

See [`docs/DEMO.md`](docs/DEMO.md) for the manual demo,
[`docs/INSTALLATION.md`](docs/INSTALLATION.md) for setup on a new Ubuntu
machine, and [`docs/DATABASE_BACKUP.md`](docs/DATABASE_BACKUP.md) for backup
and restore.
