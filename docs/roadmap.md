# Musabe Schools Management System — Roadmap

Status: authoritative order of work for Version 1.0.
Progress: `docs/progress.md`  
Detailed flows: `docs/flows.md`

---

## Current focus

**Documentation only.**  
`node/` and `web/` are deliberately not created yet.

---

## Work order

### D1 — Core documentation (done)
- README, CLAUDE.md, roadmap, progress, flows

### M0 — Project skeleton
Create `node/` (Express + Knex + Postgres + Redis) and `web/` (React + TypeScript + Vite).

### M1 — Login & authentication
- Login page (email + password)
- Remember me
- Forgot password → temporary password → forced change
- Session management
- Login activity foundation

### M2 — Dashboard + role-based sidebar
Authenticated layout. Sidebar shows only what the current role is allowed to see.

### M3 — SuperAdmin / Admin functions
- Register school branches
- Register staff and assign role + place (one branch / several / Central / all)
- Reset password, activate/deactivate, view login activity

### M4 — Library / Store core flows
Implement the full chain described in `docs/flows.md`:
- Request → School approval → Requisition → Central approval → Order & receive → Verify & pay → Catalogue → Issue → Write-off
- Books (long path) and other items (short path)
- Unique book codes

### M5 — Inventory extras
- Stock levels
- Parent contributions (Primary only)

### M6 — Reports & full audit trail

---

## Version 1.0 feature list (from proposal)

- Branch and staff registration
- Requisition and Purchase Order workflow
- Multi-level approval (Academic Master → Head Master → Manager)
- Receiving and verification by original requestor
- Library and store inventory (unique codes for books)
- Issuing and tracking
- Write-off (Head Master approval)
- Parent contributions (Primary)
- Audit trail
- Core reports

---

## Out of scope for Version 1.0

- Students & Parents
- Academics, fees, transport
- Heads of Department / Class Teachers as separate roles
- Email/SMS delivery of passwords
- Online payment gateways
