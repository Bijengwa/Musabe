# Musabe Schools Management System — Roadmap

Status: authoritative roadmap for Version 1.0 (foundation).
Progress: `docs/progress.md`

Order of authority:

```
docs/roadmap.md          what to build, in what order
        ↓
CLAUDE.md                how to work
        ↓
docs/progress.md         where we are
```

If this plan and the original proposal disagree, stop and ask.

---

## 0. Starting point

- Empty repository.
- Proposal PDF is the source of truth for roles, approval chains, and the 9-stage library flow.
- No code yet. Docs first.

---

## 1. Non-negotiable rules

### Roles (Version 1.0)

**Central Administration (shared)**
| Role        | Responsibility                                      |
|-------------|-----------------------------------------------------|
| Admin       | Registers branches and all staff; assigns roles     |
| Manager     | Final approval for purchases                        |
| Bursar      | Turns Requisition into Purchase Order; makes payments |
| Storekeeper | Orders from suppliers; receives deliveries; sends goods to schools |

**Per school**
| Role                  | Responsibility                                      |
|-----------------------|-----------------------------------------------------|
| Head Master / Headmistress | Approves school requests; final say on book write-offs |
| Academic Master       | Reviews and filters requests from teachers (especially textbooks) |
| Librarian             | Runs library + store; writes Purchase Requisitions; catalogues, issues, starts write-offs |
| Requesting Staff      | Any authorised staff member who starts a request    |

Heads of Department and Class Teachers are **not** in Version 1.0.  
Students and Parents come in Version 1.1.

### Authentication & sessions
- Opaque session ID in HttpOnly cookie (`SameSite=Lax`, `Secure` in production).
- Redis sessions; Postgres is authoritative for identity, role, status.
- Frontend only trusts `GET /api/auth/me`.
- Temporary passwords force change on next login.
- Forgot-password notifies Admin/IT; no email/SMS delivery of passwords.
- Session revocation on deactivate, password reset, role change.

### UI
- Role-based sidebar: only show what the current role can do.
- Responsive (360 / 768 / desktop), light + dark.
- Clean, professional, compact. No emoji icons.

---

## 2. High-level phases

| Phase      | Focus                                      | Status   |
|------------|--------------------------------------------|----------|
| Docs       | Roadmap, progress, CLAUDE.md               | Current  |
| M0         | Project skeleton (node/ + web/)            | Later    |
| M1         | Auth (login, remember me, forgot password, forced change) | Later |
| M2         | Dashboard shell + role-based sidebar       | Later    |
| M3         | Admin: branch registration + staff registration + reset password + activity log | Later |
| M4         | Library / Store core (requests → approvals → requisition → PO → receive → verify → issue → write-off) | Later |
| M5         | Inventory, unique book codes, parent contributions (Primary) | Later |
| M6         | Reports + audit trail                      | Later    |
| V1.1       | Students, parents, link to library         | Future   |

---

## 3. Detailed roadmap (Version 1.0)

Each step lists **Scope**, **Done when**, and **Not in this step**.

### Docs phase (current)

#### D1 — Core documentation
- **Scope:** Create README.md, CLAUDE.md, docs/roadmap.md, docs/progress.md that capture the proposal’s roles, flows and Version 1.0 feature list.
- **Done when:** Files exist on `main` and accurately reflect the proposal + the agreed starting order (login → dashboard → SuperAdmin staff registration → library flows).
- **Not in this step:** Any code in `node/` or `web/`.

### M0 — Project skeleton (after docs approved)
- **Scope:** Create `node/` (Express 5, Knex, Postgres, Redis) and `web/` (React 19 + TS + Vite) with the same layout conventions used in PSP. Basic health endpoints and a placeholder login route.
- **Done when:** Both packages install and start; empty database migrates cleanly.
- **Not in this step:** Real auth logic or UI beyond a blank page.

### M1 — Authentication
- **Scope:**
  - Login page (email + password)
  - Remember me
  - Forgot password (notifies Admin, temporary password + forced change)
  - Forced password change on first login / after reset
  - Session management (Redis + cookie)
  - Login activity / audit log foundation
- **Done when:** A seeded Admin can log in, be forced to change password, log out, and the session is correctly stored and revoked.
- **Not in this step:** Staff registration UI, role-based sidebar content, library modules.

### M2 — Dashboard shell + role-based sidebar
- **Scope:** Authenticated layout with sidebar that shows only the items allowed for the current role. Placeholder pages for every future module.
- **Done when:** After login the correct sidebar appears for Admin / Manager / Bursar / Storekeeper / Head Master / Academic Master / Librarian / Requesting Staff. Mobile drawer works.
- **Not in this step:** Real content inside any module.

### M3 — Admin: Branches & Staff
- **Scope:**
  - Register school branches (type: Primary / Secondary)
  - Register staff (name, email, temporary password)
  - Assign role + place (one branch, several branches, Central, or all)
  - Reset password from profile
  - Activate / deactivate
  - View login activity
- **Done when:** Admin can fully onboard a Librarian for Girls Secondary and that user can log in with the forced-change flow.
- **Not in this step:** Any buying or library workflows.

### M4 — Library / Store workflows (core)
- **Scope:** Implement the full request-to-write-off chain described in the proposal, with the correct approval hand-offs:
  1. Request (Requesting Staff)
  2. School approval (Academic Master → Head Master)
  3. Requisition (Librarian)
  4. Central approval (Bursar → Manager)
  5. Order & receive (Storekeeper)
  6. Verify & pay (original requestor verifies → Bursar pays)
  7. Catalogue (Librarian)
  8. Issue & track (Librarian)
  9. Write-off (Librarian → Head Master)
- Books use the longer 13-step path; other items use the shorter 9-step path.
- **Done when:** A textbook request can travel the full path and end as an issued book with a unique code, and a write-off can be approved by the Head Master.
- **Not in this step:** Parent contributions, advanced reports, multi-school stock transfers beyond the basic send-to-school step.

### M5 — Inventory & parent contributions
- **Scope:** Unique codes for every book copy, stock levels by item, parent contributions (Primary only) as an additional stock-in path.
- **Done when:** Stock reports show correct quantities and parent-contributed items are distinguishable.
- **Not in this step:** Full analytics dashboard.

### M6 — Reports & audit trail
- **Scope:** Core reports for staff and management + complete audit trail of every request, approval, receipt and issue.
- **Done when:** Management can see pending requests, stock levels and a filterable audit log.
- **Not in this step:** Version 1.1 features (students, parents, academics, fees, transport).

---

## 4. Version 1.0 feature checklist (from proposal)

- [ ] Branch and staff registration
- [ ] Requisition and Purchase Order workflow
- [ ] Multi-level approval (Academic Master → Head Master → Manager)
- [ ] Receiving and verification (original requestor confirms)
- [ ] Library and store inventory (unique book codes, stock levels)
- [ ] Issuing and tracking
- [ ] Write-off (Head Master approval)
- [ ] Parent contributions (Primary)
- [ ] Audit trail
- [ ] Core reports

---

## 5. Out of scope for Version 1.0

- Students and Parents portals
- Academics, fees, transport, announcements
- Heads of Department / Class Teachers as distinct roles
- Email / SMS password delivery
- Online payment gateways
- Multi-tenant SaaS (this is a single-organisation system for Musabe Schools)

---

## 6. Benefits (from proposal — keep visible)

| Benefit                 | Result                                              |
|-------------------------|-----------------------------------------------------|
| Clear accountability    | Every step has a named person and a record          |
| Less loss and misuse    | Books and items traced from order to issue          |
| Faster, open approvals  | Everyone can see where a request is waiting         |
| Live stock view         | Management sees stock and pending requests any time |
| Better financial control| Payment only after requestor verifies delivery      |
| Room to grow            | Later modules build on the same foundation          |
