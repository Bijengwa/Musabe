# Musabe Progress

Plan: `docs/roadmap.md`. Tick a box only when its "Done when" check passes.

Current step: **1b — Students**

## Step 1a — Accounts ✅
- [x] Backend: Express 5 + Knex + PostgreSQL, `/api/health`
- [x] Migration `20261110_001_core_accounts`: schools, users, sessions, audit_log
- [x] Seed: 3 schools + first Super Admin (temporary password)
- [x] Sign in / sign out, "keep me signed in", lock after 5 wrong passwords
- [x] Forced password change after a temporary password
- [x] Forgot password → request shows on the administrator's Home
- [x] One permissions file (`backend/src/auth/roles.js`) for sidebar + API
- [x] Staff accounts: create, edit, reset password, switch on/off (Super Admin, School Admin)
- [x] Schools page (Super Admin adds/edits)
- [x] Audit log page
- [x] Shell: role sidebar, hamburger (drawer on phone, icon rail on computer), school filter for administration
- [x] Tested: 36 API checks + browser run Super Admin → School Admin → Bursar

## Step 1a+ — My account (profile & settings) ✅
- [x] Migration `20261111_002_profile_settings`: users.email, users.preferences
- [x] API `/api/me`: profile, edit phone/email (name, username, role, school locked), preferences, devices
- [x] My profile page: locked details, contact edit, account facts, my recent activity
- [x] Settings page: Light/Dark/System, text size, change password, devices (sign out one / all others), sign out
- [x] Top-right menu: profile, settings, quick theme, sign out. Name card in sidebar opens profile
- [x] Tested: API checks + browser run (desktop and phone, light and dark)

## Real time ✅
- [x] `backend/src/realtime.js`: Server-Sent Events at `/api/events` + PostgreSQL LISTEN/NOTIFY (works with several server processes)
- [x] Every `audit()` call publishes a change ("audit" + area, e.g. `user`, `school`, later `stock`, `receipt`), so new modules are live automatically
- [x] Only people allowed to see a change are told (their school, administration, or the people involved); the message has no data
- [x] Instant sign-out when an account is switched off, password reset, or a device is signed out
- [x] Theme and profile changes follow the person to all their open devices
- [x] Frontend `src/live.js`: `useLive(['user'], load)` on each screen; "Live" dot in the top bar
- [x] Tested with 3 browsers: staff list, theme sync, school scoping, rename, switch-off, remote sign-out

## Step 1b — Students
- [ ] classes table + School Admin screen
- [ ] students table, add one
- [ ] Excel upload with preview and row errors
- [ ] Student search used by other modules

## Step 2 — Library & Sales
Agreed 2026-11-11:
- Working accounts: Finance Manager, Assistant Finance Manager, Accountant, Assistant Accountant, Bursar (each school), Librarian (each school). Director/Manager/Head Master view only.
- Damaged/lost: only Finance Manager and Accountant approve.
- Items: Finance Manager creates items and prices; they can be sold at once (no approval step).
- Sending stock: Accountant and the Finance office (FM + Assistant FM). Later a Store-keeper role receives from suppliers and sends to libraries.
- Payment: always the full amount.
- Accountant: watches bursar receipts live with alerts when receipts wait too long (e.g. paid but items not given), confirms each bursar's daily money (received/banked), approves damaged/lost, reports and Excel export.
- [x] Items & prices (migration 004, seed 02): one item list, a price per school or "not sold", boys/girls prices, price history, stop/start selling, live
- [x] Excel: download on every list (`lib/excel.js`, exceljs); items & prices upload with template, check-before-save and row mistakes
- [x] Activity page (was Audit log): filter by area (Library, Accounts, Schools, Academic), role, dates, words; Excel; who sees which area in `lib/activity.js`
- [x] Notifications (migration 005): bell with unread count, sound (Settings → on/off, test), pop-ups when the app is in the background, live
- [ ] Send stock / confirm delivery
- [ ] Sell + receipt
- [ ] Give items
- [ ] Stock levels
- [ ] Damaged / lost
- [ ] Stock requests
- [ ] Excel export for sales, receipts and stock (as each screen is built)

## Step 3 — Academic
- [ ] Subjects, topics, teaching assignments
- [ ] Exam sets and papers
- [ ] Marks entry + Excel upload
- [ ] Results and students to watch
- [ ] Support plans, question bank

## Step 4 — Dashboards & reports
- [ ] Role home pages
- [ ] Reports + export
- [ ] Settings

---

## Notes
- 2026-10-15: Repository started with documentation only.
- 2026-11-10: Plan changed: one system with modules; library = sales flow (bursar → library). Step 1a built.
- Sessions are stored in PostgreSQL (no Redis needed yet).
- Rule for new screens: call `useLive([...areas], load)`; every change must go through `audit()` (or `publish()`) so other screens update.
- Nginx: live updates work with the normal proxy; the server sends `X-Accel-Buffering: no` and a ping every 30 s.
- 2026-11-11: Each person's look (theme, text size) is saved on the server and cached in the browser. Sidebar "System settings" (Super Admin) is still for Step 4.
