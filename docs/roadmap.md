# Musabe Schools System — Roadmap

Status: authoritative plan. Replaces the Oct 2026 "request → purchase order → storekeeper" plan.
Progress: `docs/progress.md` · Clickable prototype: `musabe_schools_system.html`

One system, one database, for the three schools in Buhongwa, Mwanza:
Musabe English Medium School, Musabe Boys Secondary School, Musabe Girls Secondary School.
Modules share the same schools, staff, students and sign-in.

Stack: React 19 + Vite (`frontend/`), Node.js + Express 5 + Knex (`backend/`), PostgreSQL.

---

## 1. Rules that do not change

### Accounts (14 roles)

| Group | Role | Sees |
|---|---|---|
| Administration | Super Admin | Everything. Creates admin accounts and School Admins |
| | Director, Assistant Director | Everything, view only |
| | Manager | Approves stock requests and write-offs |
| | Finance Manager, Assistant | Prices, sends stock, all sales |
| | Accountant, Assistant | Checks receipts, stock, damages |
| Each school | School Admin | Creates the staff of own school; students; classes |
| | Head Master | Whole school, academic + sales view |
| | Academic Master | Exam sets, marks, results of own school |
| | Subject Teacher (+ Class Teacher) | Own subjects and classes |
| | Bursar | Takes payment, writes receipts |
| | Librarian | Receives stock, gives items against receipts |

- Administration roles have no school. School roles have exactly one school (checked in the database).
- Page access lives in ONE file: `backend/src/auth/roles.js` (`ACCESS`). The sidebar and every API check read from it.
- The sidebar only hides. The server checks role + school on every request.

### Sign-in and passwords
- Username + password. Opaque session token in an HttpOnly cookie; the database stores only its SHA-256 hash.
- New accounts and resets get a temporary password, shown once, handed over in person. The person must choose their own password at first sign-in.
- "Forgot password" only records a request; the administrator gives a temporary password. No SMS/email passwords.
- 5 wrong passwords lock the account for 15 minutes.
- Switching an account off, or resetting its password, signs it out everywhere.
- Every change is written to `audit_log`. Nobody can edit or delete the log.

### Money rules
- Receipt numbers per school run without gaps. **No role can cancel or edit a receipt.**
- Library gives items only against a bursar's receipt.

---

## 2. Steps

| Step | Focus | Status |
|---|---|---|
| 1a | Accounts: sign-in, forced password change, schools, staff accounts, audit log, role sidebar | **Done** |
| 1b | Students: add, load from Excel, classes per school | Next |
| 2 | Library & Sales | |
| 3 | Academic Progress | |
| 4 | Role dashboards, reports, settings | |

### Step 1a — Accounts (done)
- Tables: `schools`, `users`, `sessions`, `audit_log`.
- Super Admin creates any account; School Admin creates Head Master, Academic Master, Subject Teacher, Bursar, Librarian for own school only.
- Edit name/phone/username, reset password, switch on/off, password requests on Home.
- Done when: Super Admin → School Admin → Bursar chain works, each signs in with a temporary password, changes it, and sees only their own sidebar.

### Step 1b — Students
- Tables: `classes` (per school, level, stream), `students` (reg. no., name, gender, class).
- School Admin adds students one by one or uploads an Excel file (.xlsx): preview, show errors per row, then save.
- Registration numbers made by the system: `MS/EM/2026/001`.
- Done when: a School Admin loads a class list from Excel and the bursar can find a student by name or reg. no.

### Step 2 — Library & Sales
Flow: parent pays at the bursar → receipt → library gives items.
1. Items & prices (boy / girl price), reorder level
2. Send stock (Finance) → librarian confirms each line → stock goes up
3. Sell + receipt (gap-free numbers, prints like the school receipt book)
4. Give items → stock goes down
5. Stock levels
6. Damaged / lost: Librarian reports → Accountant verifies → Manager approves
7. Stock requests: Librarian → Manager approves → Finance sends
8. Excel export
- Go live in one school first (English Medium), run beside the Excel book for 2 weeks.

### Step 3 — Academic Progress
1. Subjects, topics per level; teacher ↔ class ↔ subject; class teacher
2. Exam sets; papers with questions tied to topics
3. Marks entry on screen and by Excel upload; "AB" for absent
4. Results: averages, bands, topic scores, students to watch (rules in Settings)
5. Support plans; question bank (NECTA + teachers)

### Step 4 — Dashboards and reports
- Each role's Home as in the prototype.
- Reports with Excel export; Settings (warning rules, current exam set).

---

## 3. Out of scope for now
- Parents and students signing in (later: Musabe Parent Connect reads from this system)
- Fees, transport, payroll
- SMS/email
- Online payments
