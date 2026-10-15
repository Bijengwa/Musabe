
## Build phases
1. Setup: skeleton, config, DB connection, Alembic, /health
2. Auth + Admin: User, Branch, RoleAssignment models, JWT, /admin endpoints
3. Requests + Approvals: workflow engine, audit log
4. Procurement: requisition, PO, order, receive, verify, pay
5. Library + Inventory: book copy codes, stock movements
6. Issuing, Write-off, Parent contributions
7. Reports, end-to-end tests, seed data

## Dev notes
- Dev database is SQLite; production is PostgreSQL. Keep models portable (no Postgres-only types).
- Python is 3.14. Use the `bcrypt` package directly for password hashing (not passlib) and PyJWT for tokens.
