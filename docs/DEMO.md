# Demo guide

This guide shows how to demonstrate the Musabe backend in two ways: a fully
automated script (recommended) and a manual walkthrough with `curl`.

## Prerequisites

From the project root, with the virtual environment active:

```bash
python -m alembic upgrade head
python -m scripts.seed
```

## Option A — automated demo (no server required)

```bash
python -m scripts.demo
```

This creates a temporary database, seeds it, and drives the real application
through the complete BOOK flow, the OTHER flow, issuing, a write-off, a parent
contribution, and the management dashboard. Every step is asserted, so the
run ends with:

```
DEMO PASSED: 27 steps executed successfully.
```

## Option B — manual walkthrough

Start the server:

```bash
python -m uvicorn app.main:app --reload
```

Open <http://127.0.0.1:8000/docs> for the interactive Swagger UI. Below is the
same flow with `curl`.

### 1. Log in and get a token

```bash
TOKEN=$(curl -s -X POST http://127.0.0.1:8000/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"staff.nursery-primary@musabe.ac.ug","password":"musabe12345"}' \
  | python -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
echo "$TOKEN"
```

Repeat with the other accounts below; each role has its own token.

### Demo accounts

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

Set one shell variable per role for convenience:

```bash
STAFF=$(curl -s -X POST localhost:8000/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"staff.nursery-primary@musabe.ac.ug","password":"musabe12345"}' | python -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
ACADEMIC=$(curl -s -X POST localhost:8000/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"academic.nursery-primary@musabe.ac.ug","password":"musabe12345"}' | python -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
HEAD=$(curl -s -X POST localhost:8000/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"head.nursery-primary@musabe.ac.ug","password":"musabe12345"}' | python -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
LIB=$(curl -s -X POST localhost:8000/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"librarian.nursery-primary@musabe.ac.ug","password":"musabe12345"}' | python -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
BURSAR=$(curl -s -X POST localhost:8000/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"bursar@musabe.ac.ug","password":"musabe12345"}' | python -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
MANAGER=$(curl -s -X POST localhost:8000/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"manager@musabe.ac.ug","password":"musabe12345"}' | python -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
STORE=$(curl -s -X POST localhost:8000/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"storekeeper@musabe.ac.ug","password":"musabe12345"}' | python -c 'import sys,json;print(json.load(sys.stdin)["access_token"])')
```

### 2. Book flow

```bash
# Requesting staff raises a BOOK request
curl -s -X POST localhost:8000/requests -H "Authorization: Bearer $STAFF" \
  -H 'Content-Type: application/json' \
  -d '{"type":"BOOK","title":"Grade 1 Mathematics","lines":[{"description":"Pupil Book","quantity":2}]}'
```

Note the `id` in the response (call it `$RID`).

```bash
RID=1

# Academic Master approves
curl -s -X POST localhost:8000/requests/$RID/approve -H "Authorization: Bearer $ACADEMIC" -H 'Content-Type: application/json' -d '{}'

# Head Master approves
curl -s -X POST localhost:8000/requests/$RID/approve -H "Authorization: Bearer $HEAD" -H 'Content-Type: application/json' -d '{}'

# Librarian raises a requisition
curl -s -X POST localhost:8000/requests/$RID/requisition -H "Authorization: Bearer $LIB" -H 'Content-Type: application/json' -d '{}'

# Bursar creates a purchase order (use a real supplier_id)
curl -s localhost:8000/suppliers -H "Authorization: Bearer $BURSAR"
curl -s -X POST localhost:8000/requests/$RID/purchase-order -H "Authorization: Bearer $BURSAR" \
  -H 'Content-Type: application/json' -d '{"supplier_id":1,"total_amount":"250000.00"}'

# Manager approves
curl -s -X POST localhost:8000/requests/$RID/manager-approval -H "Authorization: Bearer $MANAGER" -H 'Content-Type: application/json' -d '{"approve":true}'

# Storekeeper orders and receives
curl -s -X POST localhost:8000/requests/$RID/order   -H "Authorization: Bearer $STORE"
curl -s -X POST localhost:8000/requests/$RID/receive -H "Authorization: Bearer $STORE" -H 'Content-Type: application/json' -d '{}'

# Requestor verifies, Bursar pays, Storekeeper sends to school
curl -s -X POST localhost:8000/requests/$RID/verify -H "Authorization: Bearer $STAFF" -H 'Content-Type: application/json' -d '{"matched":true}'
curl -s -X POST localhost:8000/requests/$RID/pay    -H "Authorization: Bearer $BURSAR" -H 'Content-Type: application/json' -d '{}'
curl -s -X POST localhost:8000/requests/$RID/send-to-school -H "Authorization: Bearer $STORE"

# Librarian catalogues the books (status becomes CATALOGUED)
curl -s -X POST localhost:8000/library/catalogue -H "Authorization: Bearer $LIB" \
  -H 'Content-Type: application/json' -d "{\"request_id\":$RID}"
```

### 3. Issue and return a book copy

```bash
curl -s localhost:8000/library/books -H "Authorization: Bearer $LIB"   # find a code
CODE="MUS-NP-2026-000001"

curl -s -X POST localhost:8000/issues -H "Authorization: Bearer $LIB" \
  -H 'Content-Type: application/json' -d "{\"borrower\":\"Pupil Aisha\",\"book_code\":\"$CODE\"}"
# then return it
curl -s -X POST localhost:8000/issues/1/return -H "Authorization: Bearer $LIB"
```

### 4. Write-off a damaged copy

```bash
curl -s -X POST localhost:8000/write-offs -H "Authorization: Bearer $LIB" \
  -H 'Content-Type: application/json' -d "{\"book_code\":\"$CODE\",\"reason\":\"DAMAGED\"}"
curl -s -X POST localhost:8000/write-offs/1/approve -H "Authorization: Bearer $HEAD" \
  -H 'Content-Type: application/json' -d '{"approve":true}'
```

### 5. Parent contribution (PRIMARY branches only)

```bash
curl -s -X POST localhost:8000/contributions -H "Authorization: Bearer $LIB" \
  -H 'Content-Type: application/json' \
  -d '{"item_name":"Reams of paper","quantity":10,"contributor":"Parent Aisha"}'
```

### 6. Reports dashboard

```bash
curl -s localhost:8000/reports/overview -H "Authorization: Bearer $MANAGER"
curl -s localhost:8000/reports/stock -H "Authorization: Bearer $MANAGER"
curl -s localhost:8000/reports/pending-requests -H "Authorization: Bearer $MANAGER"
curl -s localhost:8000/reports/spend -H "Authorization: Bearer $MANAGER"
```

### 7. Check the audit trail

```bash
curl -s localhost:8000/reports/activity -H "Authorization: Bearer $ADMIN"
```

Every approval, procurement step, issue, write-off, and contribution appears
here — the system records who did what, when.
