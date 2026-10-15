# Musabe Schools Management System - Backend

Stack: Python 3.11, FastAPI, SQLAlchemy 2.0, Alembic, PostgreSQL, Pydantic v2, pytest.
Full spec: see docs/SPEC.md (tables, workflows, endpoints). Read it before every task.

## Folder structure
```
app/main.py
app/core/       config.py, security.py, permissions.py, database.py
app/models/     branch, user, supplier, request, procurement, library,
                inventory, issuing, writeoff, contribution, audit
app/schemas/    one Pydantic file per model
app/routers/    auth, admin, requests, procurement, library, inventory,
                issuing, writeoff, contributions, reports
app/services/   workflow, request_service, procurement_service,
                inventory_service, issuing_service, writeoff_service,
                audit_service
app/utils/codes.py
alembic/  tests/
```

## Rules
- Architecture: router -> service -> model. No business logic in routers.
- All workflow transitions go through app/services/workflow.py only.
- Every state change writes an audit_logs row.
- Roles: Admin, Manager, Bursar, Storekeeper (central);
  Head Master, Academic Master, Librarian, Requesting Staff (school).
- Users see only their own branch data; central roles see all.
- Supplier delivers to Storekeeper only. Payment only after requestor verification.
- Only Librarian issues items. Head Master approves write-offs.
- Parent contributions: Primary branches only.
- Type hints, docstrings, and a pytest test for each service.
- Use Alembic for every schema change.
- Work on one phase at a time. Do not touch other phases.
