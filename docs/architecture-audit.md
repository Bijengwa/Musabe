# Musabe Schools System — Architecture, Code Quality and Security Audit

| | |
|---|---|
| Repository | `Bijengwa/Musabe` |
| Branch audited | `library-items-excel-notifications` |
| Commit audited | `f44a4f9` |
| Audit date | 11 November 2026 |
| Audit type | Static code review of all 68 tracked files, plus small local proof tests. No application code, database records or migrations were changed. |
| References | OWASP ASVS 5.0 (target: Level 2), OWASP API Security Top 10 (2023) |

### How to read this report

Every finding has a **status**:

- **Confirmed** — seen in the code, and where possible proven with a small test.
- **Potential risk** — the code allows it, but whether it is exploitable depends on how the system is deployed.
- **Unverified** — needs a running system (database, proxy, browser) to check.

Line numbers refer to commit `f44a4f9`.

### What was actually run

| Check | Result |
|---|---|
| `eslint .` (frontend) | Passed, no problems |
| `vite build` (frontend) | Passed. One JS bundle of 334 KB (102 KB gzip) |
| `node --check` on every backend file | Passed |
| `madge --circular` (backend and frontend) | No circular dependencies |
| `npm audit` (backend) | 2 moderate: `exceljs` → `uuid` (GHSA-w5hq-g745-h8pq) |
| `npm audit` (frontend) | 4 moderate, all in dev tools (`eslint` → `minimatch`). Not shipped to users |
| Proof test: `trust proxy = 1` with a fake `X-Forwarded-For` header | `req.ip` became the fake value `6.6.6.6` (see S-02) |
| Proof test: ExcelJS writing a cell that starts with `=` | Saved as a **string** cell, not a formula (see S-18) |
| Database / runtime tests | **Not run.** No database was touched. Items that need a live system are marked "Requires runtime verification" |

---

## 1. Executive summary

Musabe is a **small, clean and readable early-stage system**. About 1,900 lines of backend code and 2,100 lines of frontend code. It already does several things well, which is not common at this stage:

- Sessions are random 256-bit tokens, stored in the database only as a SHA-256 hash, in an HttpOnly cookie.
- Passwords use bcrypt (cost 12). New accounts and resets get a one-time temporary password that must be changed.
- Switching an account off or resetting its password signs it out everywhere, including open live screens.
- Database queries are built with Knex and bound parameters. **No SQL injection was found.**
- Staff accounts are checked object by object (`canManage`) and school staff only see their own school's data. **No broken object-level authorization was found in the existing routes.**
- React output is escaped. There is no `dangerouslySetInnerHTML`. **No XSS path was found in the app.**
- Business changes are written to an `audit_log` in the same transaction as the change.
- Price changes keep a history table.

But the system is **not ready for production or for real student and money data yet**. The main problems:

1. **Critical:** a default Super Admin password (`Musabe@2026`) is published in the README, `.env.example` and the seed code. Your own local `backend/.env` still contains it.
2. **High:** the client IP address can be faked (`trust proxy = 1`), which defeats the login rate limit and corrupts audit IPs.
3. **High:** the app connects to PostgreSQL as the `postgres` superuser by default.
4. Many **Medium** issues: account lockout can be abused, accounts can be guessed (enumeration), missing CSP/HSTS, TLS not enforced, health endpoint leaks database errors, audit log can be edited by the app's database user, unlimited live connections, weak password policy, Excel upload memory risk.
5. **No automated tests, no CI, no backup plan, no deployment guide, no error monitoring.**

Architecture: the backend is a sensible **modular monolith in early form**. The biggest structural problems are: `routes/items.js` mixes HTTP, rules, queries, Excel and events (302 lines); role data is copied between backend and frontend; migrations import live application code; and there is no service or validation layer yet. These are easy to fix now and expensive to fix after Finance is added.

**Recommendation:** fix the Critical and High findings (Phase 1, about 1–2 weeks), add a test harness and CI, then refactor module by module before building Students and Finance. Do not merge this branch to `main` for production use until S-01, S-02 and S-03 are closed.

### Where I agree and disagree with the baseline plan

The baseline document (the "Professional Architecture, Security and Engineering Roadmap") is mostly right. I checked each of its eight security claims against the code. All eight describe real code. But I disagree with some **severity ratings** and some **architecture choices**, and it **misses** several findings.

| Baseline item | Baseline rating | My rating | Why |
|---|---|---|---|
| Default admin credentials | Critical | **Critical** (agree) | Confirmed in 3 files. `must_change_password` helps, but whoever signs in first on a fresh server owns it. |
| CSRF | High | **Medium** | `SameSite=Lax` blocks cross-site cookie sending on POST/PATCH/PUT in current browsers. The JSON routes only parse `application/json`, and there is no CORS, so a cross-site form cannot send a valid body. The real gaps are same-site attacks (another `*.musabeschools.ac.tz` site) and the Excel import route, which accepts any content type. Still fix it — but it is defence in depth, not an open hole. |
| Security headers | High | **Medium** | Three headers are set. Missing CSP and HSTS matter, but React already escapes output and no XSS was found. |
| Health endpoint leaks error | High | **Medium** | It leaks host, port and DB user names only when the database is down. Real, but not High. |
| Lockout abuse | Medium–High | **Medium** (agree in substance) | Plus: account enumeration through the lockout message, which the baseline did not mention (S-05). |
| Excel upload | Medium–High | **Medium** | Real memory risk (zip bomb). But only the **Finance Manager** role can reach the route, so the attacker must already hold a privileged account. |
| Spreadsheet formula injection | listed as a risk | **Low / Informational** | I tested it: ExcelJS writes text that starts with `=` as a string cell, not a formula, so the current `.xlsx` exports do not execute anything. Becomes real only if CSV export is added. Add a guard anyway. |
| School data visibility | Medium–High | **Low** | It shows school names, staff counts and School Admin names to all staff. That is internal directory data, not student or money data. Fix with least privilege, but it is not Medium–High. |
| SSE connection limits | Medium | **Medium** (agree) | |
| Argon2id | "evaluate" | **Keep bcrypt for now** | bcrypt cost 12 is acceptable under OWASP guidance. Moving gives little security for the effort right now. Revisit in a later phase. |

**Findings the baseline missed:**

- S-02 Client IP spoofing through `trust proxy` (High, proven by test).
- S-03 Application runs as the PostgreSQL superuser (High).
- S-05 Account enumeration through the 423 lockout reply and response timing.
- S-12 The audit log is "read only" only in the app. The database user can edit or delete it. Deleting an item also deletes its price history (`ON DELETE CASCADE`).
- S-13 Temporary passwords never expire.
- D-01 Migration `001` imports `src/auth/roles.js`, so the migration's meaning changes when the roles file changes.
- A-05 Two server entry points with different default ports (4310 vs 3001). `docs/running-locally.md` is wrong about the default.
- Q-01 No automated tests at all, and no CI.

**Architecture points where I disagree:**

1. **Do not give every module `controllers/ services/ repositories/ validators/` folders from day one.** The whole backend is 16 files. Four empty layers per module adds ceremony and no safety. Use one file per layer per module (`items.routes.js`, `items.service.js`, `items.schema.js`), and add a repository file only when queries are reused or complex (Finance will need it; Notifications will not).
2. **No "API Gateway" box.** For one Node process, Nginx (or Caddy) as a reverse proxy doing TLS, request size limits and rate limits is enough. A separate gateway product would be an unnecessary service.
3. **Institution / school / campus / branch hierarchy:** agree on the idea, but do not create a `campuses` or `institutions` table until a second campus or a second institution really exists. Today Musabe is one institution with three schools. The `schools` table already represents the "school / academic division" level correctly. Add `academic_years`, `terms`, `classes` and `streams` when Students are built. (The multi-tenant SaaS idea belongs in a separate product, not inside Musabe.)
4. **Row-Level Security in PostgreSQL** is worth adding for Finance and student records (not mentioned in the baseline). It turns "the app forgot a `where school_id`" from a data leak into an empty result.

---

## 2. Current repository architecture

```
Browser (React 19 + Vite SPA, port 5190 in dev)
   │  fetch('/api/...')  with HttpOnly session cookie
   │  EventSource('/api/events')  (Server-Sent Events)
   ▼
Express 5 API (Node 20+, port 4310)
   ├─ middleware: json(1mb) → cookieParser → 3 security headers → loadUser
   ├─ routes/auth.js           login, logout, me, change-password, forgot
   ├─ routes/me.js             own profile, preferences, devices
   ├─ routes/users.js          staff accounts (+ Excel export)
   ├─ routes/schools.js        schools
   ├─ routes/audit.js          activity log (+ Excel export)
   ├─ routes/notifications.js  bell, built from audit_log
   ├─ routes/items.js          items, prices, Excel import/export
   ├─ auth/roles.js            roles + page access table (single source)
   ├─ auth/session.js          sessions, requireAuth, requirePage
   ├─ lib/util.js              HttpError, audit(), phone, password rules
   ├─ lib/activity.js          who may see which audit groups
   ├─ lib/excel.js             ExcelJS read/write
   └─ realtime.js              SSE + PostgreSQL LISTEN/NOTIFY
   ▼
PostgreSQL via Knex (one connection pool, one DB user)
   tables: schools, users, sessions, audit_log, items, item_prices, item_price_changes
```

Layering today: **route → Knex**. There is no service layer and no validation library. Authorization is a page-level table (`ACCESS` in `roles.js`) plus object checks inside routes.

The design idea that "real-time events only say *what* changed, and the screen re-fetches through the normal permission-checked API" (`realtime.js` lines 8–9) is a **good security decision** and should be kept.

---

## 3. Complete current file structure

All 68 tracked files at `f44a4f9`, with line counts.

```
Musabe/
├── .gitignore                                        13
├── README.md                                         57
├── Musabe Academic Progress.html                  (prototype, 168 KB)
├── Musabe_Schools_Academic_Performance_System_Concept.pdf (48 KB)
├── musabe_library_prototype.html                  1106 (prototype)
├── musabe_schools_system.html                     1033 (prototype)
├── docs/
│   ├── progress.md                                   84
│   ├── roadmap.md                                   101
│   └── running-locally.md                            57
├── backend/
│   ├── .env.example                                  17
│   ├── .gitignore                                     2
│   ├── knexfile.js                                   19
│   ├── package.json                                  29
│   ├── package-lock.json                           3585
│   ├── server.js                                      4   (second entry point)
│   ├── migrations/
│   │   ├── 20261110_001_core_accounts.js             71
│   │   ├── 20261111_002_profile_settings.js          17
│   │   ├── 20261111_003_tz_phone.js                  15
│   │   ├── 20261111_004_library_items.js             62
│   │   └── 20261111_005_notifications.js              5
│   ├── seeds/
│   │   ├── 01_schools_and_super_admin.js             30
│   │   └── 02_library_items.js                       23
│   └── src/
│       ├── server.js                                 54
│       ├── db.js                                      4
│       ├── realtime.js                              103
│       ├── auth/
│       │   ├── roles.js                              71
│       │   └── session.js                            97
│       ├── lib/
│       │   ├── activity.js                           42
│       │   ├── excel.js                              81
│       │   └── util.js                               60
│       └── routes/
│           ├── audit.js                              61
│           ├── auth.js                               89
│           ├── items.js                             302
│           ├── me.js                                128
│           ├── notifications.js                      36
│           ├── schools.js                            62
│           └── users.js                             179
└── frontend/
    ├── .gitignore                                    24
    ├── README.md                                     16   (Vite template text)
    ├── eslint.config.js                              21
    ├── index.html                                    25
    ├── package.json                                  28
    ├── package-lock.json                           2505
    ├── vite.config.js                                19
    ├── public/musabe-logo.png
    └── src/
        ├── main.jsx                                  19
        ├── App.jsx                                   44
        ├── App.css                                    1   (unused: "Not used")
        ├── index.css                                393
        ├── api.js                                    32
        ├── live.js                                   57
        ├── nav.js                                    49
        ├── prefs.js                                  26
        ├── auth/AuthContext.jsx                      90
        ├── components/ui.jsx                        141
        ├── layout/
        │   ├── Bell.jsx                             116
        │   ├── Shell.jsx                            146
        │   └── scope.jsx                             21
        └── pages/
            ├── Audit.jsx                             84
            ├── ChangePassword.jsx                    44
            ├── ComingSoon.jsx                        12
            ├── Home.jsx                             116
            ├── Items.jsx                            278
            ├── Login.jsx                             59
            ├── Profile.jsx                          143
            ├── Schools.jsx                           66
            ├── Settings.jsx                         210
            └── Staff.jsx                            223
```

Untracked local files seen (correctly ignored): `backend/.env`, `.backend.log`, `.backend.err.log`, `.frontend.log`, `Claude outputs/`, `node_modules/`.

---

## 4. Architecture weaknesses

### Backend

| ID | Problem | Evidence | Impact | Fix |
|---|---|---|---|---|
| A-01 | **Mixed responsibilities in `routes/items.js`** (302 lines): HTTP handling, input parsing, price rules, gender rules, SQL, price history, audit, real-time events, Excel template, Excel import planning and saving. | `items.js` whole file; `readBody` 57–85, `savePrices` 88–109, import 226–300 | The same price rules exist twice: once in `readBody` (form) and again in the import loop (240–277). They will drift apart. Hard to test without HTTP. | Split into `library/items.service.js` (rules + `savePrices`), `items.repository.js` (queries), `items.schema.js` (validation), `items.import.js` (Excel planning), `items.routes.js` (thin). Make form and import call the **same** `validatePrice()` function. |
| A-02 | **Business logic in routes** everywhere else too. | `users.js` 82–111 (create rules), 121–162 (edit rules, last-Super-Admin rule); `auth.js` 16–38 (lockout logic); `schools.js` 39–49 | Rules cannot be unit-tested. Finance will copy this pattern. | Move to `*.service.js` per module. Routes only read the request, call the service, send the reply. |
| A-03 | **No validation layer.** Every route hand-parses `req.body` with `String(...)`, regexes and `Number(...)`. | e.g. `users.js` 84–96, `schools.js` 27–37, `items.js` 21–26 | Inconsistent rules; `Number('abc')` → `NaN` reaches SQL and causes a 500 (e.g. `users.js` 50 `Number(school)`). | Adopt one schema library (Zod or Joi) with a `validate(schema)` middleware. |
| A-04 | **Database errors are not mapped.** Unique-constraint violations become HTTP 500. | Check-then-insert in `users.js` 99–108, `schools.js` 42–46, `items.js` 63 | Under two simultaneous requests the second gets "Something went wrong" instead of 409. | In the error handler, map PostgreSQL code `23505` → 409, `23514` → 400. |
| A-05 | **Two entry points with different defaults.** `backend/server.js` (port 4310, **does not call `realtime.listen()`**) and `src/server.js` (port **3001**, calls `listen()`). `docs/running-locally.md` says the default in `src/server.js` is 4310 — it is 3001. | `backend/server.js` 1–4; `src/server.js` 48–52 | Started the "other" way, live updates silently fall back to in-process only, and the port does not match the Vite proxy. | Keep one entry: `src/server.js` (process start) + `src/app.js` (Express app, for tests). Read `PORT` from validated config with one default. Fix the doc. |
| A-06 | **No configuration validation.** `process.env` is read in 6 places with silent fallbacks (`DATABASE_USER` → `postgres`, `DATABASE_PASSWORD` → `''`, admin password → `Musabe@2026`). | `knexfile.js` 5–11; seed 16–19; `session.js` 15 | Production can start with dangerous defaults and nobody notices. | One `config/env.js` that validates with a schema and **refuses to start** in production when a required value is missing. |
| A-07 | **Migrations import application code.** | `migrations/20261110_001_core_accounts.js` line 2 imports `src/auth/roles.js` | If someone adds or renames a role in `roles.js`, a fresh database built from migration 001 gets a different CHECK constraint than the existing production database. Migrations must be frozen history. | Copy the role list as a literal inside the migration. New roles → new migration that replaces the CHECK. |
| A-08 | **Duplicated role data in the frontend.** `ADMIN_ROLES` and `ROLE_LABELS` are hard-coded again. | `frontend/src/nav.js` 43–49 vs `backend/src/auth/roles.js` | Adding a role needs two edits; they will drift. The API already returns `roleLabel` and `scope`. | Send a `roles` list from `/api/auth/me` (or a `/api/meta` endpoint) and delete the frontend copy. |
| A-09 | **Hard-coded role checks in pages** instead of permissions. | `Home.jsx` 20, 43, 45, 54, 68; `Staff.jsx` 36; `Audit.jsx` 46 (`user.role === 'super'`) | Other "all schools" roles (Director, Manager) do not get the school filter on Home. Permissions become scattered. | Use `can()` or `user.scope === 'all'`. |
| A-10 | **Page-based permissions only.** `ACCESS` maps roles to *pages* (`items:'f'`). There are no named permissions like `item.price.update`. | `roles.js` 35–55 | Fine today. For Finance you will need action-level control (create invoice vs approve refund vs reconcile), and separation of duties. | Introduce permission constants (`finance.refund.approve`) mapped to roles. Keep `ACCESS` for the sidebar, derived from permissions. |
| A-11 | **No structured logging.** Only `console.error(err)`; no request id, no log levels, no security events. | `server.js` 44 | Hard to investigate incidents; secrets may end in logs (full error objects). | Add `pino` + `pino-http` with request ids and redaction of `cookie`, `authorization`, `password`. |
| A-12 | **No background job runner.** Expired sessions are never deleted; Excel import runs in the request. | `session.js` (no cleanup); `items.js` 226 | Table growth; long requests block. Finance reconciliation will need jobs. | Start with a small scheduled task (e.g. `node-cron` or a PostgreSQL-based queue such as `pg-boss`). Do not add Redis until needed. |
| A-13 | `lib/util.js` mixes unrelated things: HTTP errors, hashing, password rules, phone rules, username generation, and the audit writer (which also publishes events). | `util.js` | "util" files grow without limit. | Split into `shared/errors.js`, `shared/phone.js`, `modules/auth/password.js`, `modules/audit/audit.service.js`. |

### Repository and documentation

| ID | Problem | Fix |
|---|---|---|
| A-14 | Four prototype files (≈470 KB of HTML/PDF) live in the repo root, one with a space in its name. | Move to `docs/prototypes/` and `docs/concept/`. Rename without spaces. |
| A-15 | `frontend/README.md` is the Vite template text. `frontend/src/App.css` is an unused 1-line file. | Replace README; delete `App.css` in the refactor phase. |
| A-16 | Missing documents: architecture overview, API reference, deployment guide, backup/restore guide, security policy, environment variable reference, contribution rules. | See roadmap Phase 2 and Phase 7. |
| A-17 | No `engines` / Node version pin for the frontend; backend says `>=20` but your machine ran Node 24 (`.backend.err.log`). | Add `.nvmrc` with one LTS version and use it in CI. |

**Positive points (keep these):** no circular dependencies (verified with `madge`); small dependency list (8 backend, 3 frontend runtime deps, none unnecessary); one source of truth for roles on the backend; clear comments in plain English; consistent naming (`*.js` camelCase, routes named by resource).

---

## 5. Security findings ranked by severity

Summary:

| Severity | Count | IDs |
|---|---|---|
| Critical | 1 | S-01 |
| High | 2 | S-02, S-03 |
| Medium | 10 | S-04 … S-13 |
| Low | 5 | S-14 … S-18 |
| Informational | 2 | S-19, S-20 |

---

### S-01 — Default Super Admin password is public · **Critical** · Confirmed

- **Where:** `backend/seeds/01_schools_and_super_admin.js` `exports.seed`, line 19 (`|| 'Musabe@2026'`); `backend/.env.example` line 15; `README.md` line 35. Your local `backend/.env` also contains this value (checked by search only; value not copied).
- **Problem:** anyone who reads the repository knows the first administrator password. `must_change_password = true` does **not** protect you, because whoever signs in first chooses the new password.
- **Exploitation:** the system is deployed to a server reachable on the internet. Before the school's administrator signs in, an attacker opens the login page, enters `superadmin` / `Musabe@2026`, chooses their own password, and now owns every account, school and price. The real administrator is locked out.
- **Fix:**
  1. Remove the fallback. The seed must stop with an error if `SUPERADMIN_PASSWORD` is not set, or better: generate a random password, print it once to the console, never store it.
  2. Remove the password from `README.md` and `.env.example` (use `SUPERADMIN_PASSWORD=` with a comment "required, at least 14 characters").
  3. Add an expiry for the first temporary password (see S-13).
  4. On any server where the seed already ran with the default, confirm the password was changed, and check `audit_log` for `auth.login` by `superadmin` from unknown IPs.
  5. Consider the value compromised in git history: never reuse it.
- **Verification test:** run the seed with no `SUPERADMIN_PASSWORD` → it must fail or print a random password. `grep -r "Musabe@2026"` over the repo returns nothing. Integration test: login with `Musabe@2026` on a fresh seed returns 401.

### S-02 — Client IP can be faked through `X-Forwarded-For` · **High** · Confirmed (proof test)

- **Where:** `backend/src/server.js` line 9 `app.set('trust proxy', 1)`. Used by `express-rate-limit` in `routes/auth.js` line 11, `audit()` in `lib/util.js` line 54, and `startSession` in `auth/session.js` line 27.
- **Problem:** `trust proxy = 1` tells Express "the last hop is a trusted proxy, believe the `X-Forwarded-For` header". If the API is reachable **directly** (no proxy, or a proxy that appends rather than replaces the header, or two proxies), the client controls `req.ip`. I tested this: a request with `X-Forwarded-For: 6.6.6.6` produced `req.ip = 6.6.6.6`.
- **Exploitation:** an attacker sends each login attempt with a new fake IP. The 30-per-15-minutes login limit never triggers, so password guessing is limited only by the per-account lock (5 per 15 min per account = 480 guesses per day per account, across every account). The attacker can also write any IP they like into the audit log and the "devices" list, hiding the real source.
- **Fix:** read the proxy setting from config. In production set it to the exact proxy address (e.g. `'loopback'` when Nginx runs on the same server) and make Nginx **overwrite** the header (`proxy_set_header X-Forwarded-For $remote_addr;`). Bind Node to `127.0.0.1` so it cannot be reached directly. In development, set `trust proxy` to `false`.
- **Verification test:** automated test: with production config, a request with a fake `X-Forwarded-For` must be rate-limited after 30 attempts. Runtime check: `curl` the server's public IP on the Node port must fail to connect.

### S-03 — Application connects as the PostgreSQL superuser · **High** · Potential risk (configuration)

- **Where:** `backend/knexfile.js` line 8 (`DATABASE_USER || 'postgres'`); `.env.example` line 8; your local `.env` has no `DATABASE_USER`, so it uses `postgres`.
- **Problem:** the running app, the migrations and the seeds all use one account with full power over the whole PostgreSQL server. No SQL injection was found today, but any future injection, or a leaked `.env`, gives total control: read every database on the server, drop tables, or run operating-system commands through `COPY ... PROGRAM`.
- **Exploitation:** a future report query is written with string concatenation by mistake. An attacker uses it to run `COPY (SELECT '') TO PROGRAM '...'` and takes over the server.
- **Fix:** create two roles: `musabe_owner` (owns tables, used only for migrations) and `musabe_app` (only `SELECT/INSERT/UPDATE/DELETE` on the needed tables, **only `INSERT, SELECT` on `audit_log` and `item_price_changes`**). Run the app as `musabe_app`. Use a strong generated password and `sslmode=require` if the database is on another machine. Refuse `postgres` as the user when `NODE_ENV=production`.
- **Verification test:** connected as `musabe_app`, `DELETE FROM audit_log` and `CREATE TABLE x()` must fail with "permission denied". Startup in production with `DATABASE_USER=postgres` must exit with an error.

### S-04 — Anyone can lock any staff account · **Medium** · Confirmed

- **Where:** `routes/auth.js` `POST /login`, lines 14–31.
- **Problem:** 5 wrong passwords lock the account for 15 minutes. The attacker needs only the username, and usernames are predictable (`firstname.lastname`, generated by `suggestUsername` in `util.js` 38–45, and shown on receipts and the audit log).
- **Exploitation:** on fee-payment day, someone repeatedly sends 5 wrong passwords for every bursar's username (`peter.mwakalinga`, ...). Bursars cannot sign in all day. Combined with S-02, IP rate limits do not stop it.
- **Fix:** replace hard lock with progressive delay per account (e.g. 1s, 2s, 4s… up to 30s) plus a per-IP limit (after S-02 is fixed) plus a global "many failures across many accounts" alarm. Keep a hard lock only for privileged roles, and notify them. Add MFA (TOTP) for Super Admin, Director and finance roles before Finance goes live.
- **Verification test:** after 20 wrong attempts from another IP, the real user with the correct password can still sign in (perhaps after a short delay). Alert is written when failures exceed a threshold.

### S-05 — Account enumeration (which usernames exist) · **Medium** · Confirmed (timing part needs runtime check)

- **Where:** `routes/auth.js` lines 19–23 and 24.
- **Problem:** two leaks.
  1. A locked account answers **HTTP 423** "Too many wrong passwords. Try again after 14:35". A username that does not exist always answers 401. So: send 5 wrong passwords, then a 6th — 423 means the account exists.
  2. For an unknown username the reply returns at once; for a real username bcrypt runs (~250 ms at cost 12). The time difference shows which usernames exist.
- **Exploitation:** attacker builds a list of real staff usernames, then targets them with password guessing (S-02) or lockout (S-04) or phishing.
- **Fix:** always run one bcrypt compare (against a fixed dummy hash when the user does not exist). Return the same 401 message for "wrong", "locked" and "unknown"; tell the real user about a lock by a different channel (admin notification), or use only delays (S-04). The `forgot` route already does this correctly — reuse that approach.
- **Verification test:** automated: unknown user, wrong password and locked user give identical status and body. Runtime: median response time difference < 20 ms over 100 requests.

### S-06 — CSRF protection relies only on `SameSite=Lax` · **Medium** · Potential risk

- **Where:** `auth/session.js` `cookieOpts`, lines 12–18; all state-changing routes; especially `routes/items.js` line 226 `express.raw({ type: () => true })`.
- **Problem:** there is no CSRF token and no `Origin` check. Today, cross-site attacks are blocked by `SameSite=Lax` plus JSON-only bodies plus no CORS (see section 1 for why I rate this Medium, not High). But "same-site" includes **every subdomain** of `musabeschools.ac.tz`. If any other site on that domain (a blog, an old WordPress, a parents' portal) has an XSS bug, it can make authenticated POST requests here. The Excel import route accepts *any* content type, so a simple HTML form from that subdomain can post to it.
- **Exploitation:** a vulnerable page on `news.musabeschools.ac.tz` posts a crafted file to `https://sms.musabeschools.ac.tz/api/items/import` while the Finance Manager is signed in, changing all prices.
- **Fix:** add a middleware that, for every non-GET request, requires the `Origin` (or `Referer`) header to equal the app's own origin, and require a custom header (e.g. `X-Requested-With: musabe`) that browsers will not send cross-site without CORS. Restrict `express.raw` on the import route to the `.xlsx` MIME type. Use the `__Host-` cookie prefix in production (forces `Secure`, `Path=/`, no `Domain`).
- **Verification test:** POST with `Origin: https://evil.example` → 403. POST without the custom header → 403. Import with `Content-Type: text/plain` → 415.

### S-07 — Missing security headers (CSP, HSTS, others) · **Medium** · Confirmed

- **Where:** `backend/src/server.js` lines 13–16 (only `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy`).
- **Problem:** no Content-Security-Policy, no Strict-Transport-Security, no Permissions-Policy, no Cross-Origin-Opener-Policy. Also the SPA HTML is served by Vite/Nginx, not by Express, so headers set in Express **do not cover the HTML page at all** in the current setup.
- **Exploitation:** if an XSS bug is introduced later (e.g. a rich-text field, or a library), there is no CSP to limit it. Without HSTS, a user on school Wi-Fi typing `sms.musabeschools.ac.tz` can be downgraded to HTTP.
- **Fix:** use `helmet` on the API. Set a strict CSP on the HTML at the web server (`default-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'`). The small inline theme script in `frontend/index.html` lines 11–19 must then be moved to a file or given a hash. HSTS at the HTTPS edge.
- **Verification test:** run `curl -I` on `/` and `/api/health` in staging; check with securityheaders.com or ZAP baseline scan; CI check that fails if CSP is missing.

### S-08 — TLS not enforced; cookie security depends on `NODE_ENV` · **Medium** · Potential risk

- **Where:** `auth/session.js` line 15 `secure: process.env.NODE_ENV === 'production'`; no HTTPS redirect anywhere; your local `.env` has `NODE_ENV=development`.
- **Problem:** if the server is started without `NODE_ENV=production` (easy to forget with PM2 or Windows services), the session cookie is sent over plain HTTP. The cookie name is `musabe_sid` without the `__Host-` prefix.
- **Exploitation:** staff use the system over HTTP on a shared network; someone on the network copies the cookie and acts as that person for up to 30 days.
- **Fix:** `secure` from validated config, defaulting to `true`; production refuses to start if not set. Redirect HTTP→HTTPS at Nginx. Rename cookie to `__Host-musabe_sid` in production.
- **Verification test:** in staging, `Set-Cookie` contains `Secure; HttpOnly; SameSite=Lax; Path=/` and the `__Host-` prefix; `http://` redirects with 301 to `https://`.

### S-09 — Public health endpoint leaks database errors · **Medium** · Confirmed

- **Where:** `backend/src/server.js` lines 18–25, `GET /api/health`, `error: e.message`.
- **Problem:** no sign-in is needed. When the database is down or misconfigured, the reply contains the raw PostgreSQL / `pg` message, for example `password authentication failed for user "postgres"` or `connect ECONNREFUSED 127.0.0.1:5432`.
- **Exploitation:** attacker learns the database user name, host and port — useful with S-03.
- **Fix:** public reply `{ ok: false }` only. Log details server-side. If detailed health is needed, put it behind authentication or bind it to localhost.
- **Verification test:** stop PostgreSQL; `GET /api/health` returns 503 with no `error` field.

### S-10 — Excel import can exhaust server memory · **Medium** · Confirmed by code; needs runtime test

- **Where:** `routes/items.js` line 226 (5 MB raw limit), line 227 `readExcel`, line 229 row limit; `lib/excel.js` `readExcel`, lines 52–79.
- **Problem:** `.xlsx` is a ZIP file. A 5 MB upload can expand to hundreds of MB or more in memory (a "zip bomb"). ExcelJS loads the whole workbook into memory **before** the 3,000-row check. The check also only runs after all rows are read.
- **Exploitation:** a stolen or malicious Finance Manager account uploads a crafted file; the Node process runs out of memory and every user is disconnected. Mitigation already present: only the `fm` role has `items:'f'` (verified), so the risk is limited to privileged users.
- **Fix:** before parsing, open the ZIP with a streaming reader and reject if total uncompressed size > ~20 MB or the sheet XML is too large; use ExcelJS's streaming `WorkbookReader` and stop after 3,001 rows; accept only the first worksheet; reject unexpected content types; limit uploads per user per minute; run the import in a background job when files grow.
- **Verification test:** upload a 5 MB zip bomb in staging → rejected with 400 in < 2 s, memory stays below a set limit. Upload a 3,001-row file → rejected before full parse.

### S-11 — Unlimited real-time (SSE) connections · **Medium** · Confirmed

- **Where:** `backend/src/realtime.js` `stream`, lines 81–94; `clients` Set line 15.
- **Problem:** any signed-in user can open any number of `/api/events` connections. Each holds a socket and memory forever, and each `publish` loops over all of them.
- **Exploitation:** one teacher account (or a buggy browser tab loop) opens 5,000 connections; the server runs out of file handles and stops answering everyone.
- **Fix:** limit per session (e.g. 3) and per user (e.g. 10); close the oldest when over. Set a global cap. Also limit at Nginx (`limit_conn`). Expose `clientCount()` in metrics.
- **Verification test:** open 11 streams with one account → the 11th is refused (429) or the oldest is closed.

### S-12 — Audit log and price history are not tamper-resistant · **Medium** · Confirmed

- **Where:** `migrations/20261110_001_core_accounts.js` lines 52–63 (`audit_log`); `migrations/20261111_004_library_items.js` line 45 (`item_price_changes.item_id ... onDelete('CASCADE')`); comment in `routes/audit.js` line 1 says "Nobody can edit or delete it".
- **Problem:** the "cannot edit" rule exists only because no route edits it. The database user (which is the superuser, S-03) can `UPDATE` or `DELETE` audit rows. Deleting an item silently deletes all its price history. Failed logins are not logged individually (S-14).
- **Exploitation:** someone with database access changes prices, sells items, then deletes the audit rows and the item. There is no trace.
- **Fix:** (a) DB permissions: app role has only `INSERT, SELECT` on `audit_log` and `item_price_changes`; (b) a trigger that raises an error on `UPDATE`/`DELETE` of these tables; (c) change the cascade to `RESTRICT` (items are archived, never deleted — this matches current behaviour); (d) later, hash-chain audit rows (each row stores a hash of the previous row) and ship a daily copy off the server.
- **Verification test:** as the app role, `UPDATE audit_log SET summary='x'` fails. `DELETE FROM items WHERE id=1` fails while history exists.

### S-13 — Weak password policy; temporary passwords never expire; no MFA · **Medium** · Confirmed

- **Where:** `lib/util.js` `checkPassword` lines 31–35 (8 characters, one letter and one digit); `tempPassword` lines 13–17; `users.js` lines 98–110 and 165–177.
- **Problem:** `password1` and `musabe2026` are accepted. No check against common or breached passwords. No maximum length (bcrypt ignores bytes after 72, so two long passwords that share the first 72 bytes are equal). Temporary passwords (~30 bits of randomness) stay valid forever until used. No MFA for any role.
- **Exploitation:** a new staff account is created and the temporary password note is left on a desk; weeks later someone uses it. Or a bursar chooses `musabe2026`.
- **Fix:** ASVS 5.0 approach: minimum 12 characters (8 is the absolute floor in ASVS L1), maximum 64–128, no composition rules, block a list of common passwords and Musabe-specific words, optional breached-password check (k-anonymity API) if network policy allows. Temporary passwords expire after 72 hours (add `temp_password_expires_at`). TOTP MFA for privileged and finance roles before Phase 5.
- **Verification test:** unit tests for `checkPassword` with a list of bad passwords; integration test: temp password older than 72 h → login refused with "ask your administrator".

### S-14 — Security events are not fully logged · **Low** · Confirmed

- **Where:** `routes/auth.js` line 30 (only the lock is logged); line 21 and 31 (failed logins not logged).
- **Problem:** individual failed sign-ins, 403 permission denials, and CSRF/origin rejections are not recorded. You cannot see a slow password-guessing attack.
- **Fix:** log `auth.login_failed` (username tried, IP, user agent) to a security log (not the user-facing activity feed, to avoid noise), and 403s at warn level. Alert on spikes.
- **Verification test:** a wrong password creates one `auth.login_failed` log entry.

### S-15 — School directory visible to every role · **Low** · Confirmed

- **Where:** `routes/schools.js` `GET /`, lines 17–25 (only `requireAuth`, no `requirePage`).
- **Problem:** every teacher and librarian can see all schools, their active staff counts and the names of every School Admin.
- **Fix:** return only `id, name, shortName, code, students` to all users. Return `staffCount` and `schoolAdmins` only to roles with `schools` page access.
- **Verification test:** as a teacher, response has no `staffCount` or `schoolAdmins` keys.

### S-16 — "Forgot password" can be triggered for anyone · **Low** · Confirmed

- **Where:** `routes/auth.js` `POST /forgot`, lines 77–87.
- **Problem:** anyone can mark any username as "asked for a new password". Admins see it on Home with a "Give temporary password" button. This can be used for social engineering ("I'm Peter, I asked for a reset, please read me the new password over the phone").
- **Fix:** keep the design (in-person handover is good), but write a clear rule in the admin screen: "Give the password only in person, after checking identity". Rate-limit per username. Show the request IP/time to the admin.
- **Verification test:** procedure review; rate limit test (more than 3 requests per username per day are ignored).

### S-17 — Sessions: no idle timeout, expired rows never removed · **Low** · Confirmed

- **Where:** `auth/session.js` lines 9–10 (12 h / 30 days absolute), `loadUser` lines 47–63.
- **Problem:** with "keep me signed in", a session lives 30 days even if unused for 29 days. Expired session rows are never deleted. School accounts are not blocked if their **school** is set inactive.
- **Fix:** add an idle timeout (e.g. 8 hours of no use, or 7 days for "remember me"); a daily job deletes expired sessions; for finance roles, do not offer "remember me". Check `schools.active` in `loadUser`.
- **Verification test:** session unused longer than idle limit → 401.

### S-18 — Spreadsheet formula injection · **Low** · Verified not exploitable today

- **Where:** `lib/excel.js` `sendExcel` line 31. Exports include user-controlled text (staff names, audit summaries, item names).
- **Result of test:** ExcelJS stored `=HYPERLINK(...)` as a **string** cell (`type 3`), not a formula. Excel will not run it unless a user edits the cell. So the current `.xlsx` exports are safe.
- **Remaining risk:** if CSV export is added, or someone changes code to pass `{ formula: ... }`, it becomes exploitable.
- **Fix:** add a small guard in `sendExcel`: for string values starting with `=`, `+`, `-`, `@`, tab or CR, prefix with `'`. Cheap and future-proof.
- **Verification test:** unit test: export a row with name `=1+1`; read the file back; cell value is text `'=1+1` (or a string cell), never a formula.

### S-19 — Dependency advisories · **Informational** · Confirmed

- **Backend:** `exceljs@4.4.0` depends on an old `uuid` with advisory GHSA-w5hq-g745-h8pq (buffer bounds in v3/v5/v6 when a buffer is passed). ExcelJS does not appear to call those functions with a buffer, so it is likely not reachable. `npm audit fix` proposes downgrading to `exceljs@3.4.0`, which is **not** a good fix. Track upstream; consider an `overrides` entry for `uuid` after testing.
- **Frontend:** 4 moderate advisories in `eslint` / `minimatch`, dev-only, not shipped.
- **Fix:** enable Dependabot or Renovate; run `npm audit --omit=dev` in CI and fail on High.

### S-20 — Unhandled errors in some UI actions · **Informational** · Confirmed

- **Where:** `frontend/src/pages/Home.jsx` `giveTemp` lines 56–60 (no `try/catch`); no React error boundary in the app.
- **Problem:** a failed reset shows nothing; a render error blanks the whole screen.
- **Fix:** catch and toast; add one top-level error boundary.

### Controls checked and found correct (no finding)

| Area | Evidence |
|---|---|
| SQL injection | All `whereRaw` / `db.raw` calls use `?` bindings (`auth.js` 19, `activity.js` 33, `users.js` 101, `schools.js` 42, `items.js` 63). The only string interpolation into SQL is in migrations, from constant lists. |
| XSS (app) | No `dangerouslySetInnerHTML`, `innerHTML` or `eval` in `frontend/src`. Prototype HTML files use `innerHTML` but they are not part of the app. |
| Session token | 32 random bytes (`session.js` 21), only SHA-256 stored (24), deleted on logout (35), HttpOnly. New token on each login (no session fixation). |
| Password hash exposure | `loadUser` deletes `password_hash` (60); `users.js` selects fixed columns (`COLS`). |
| Object-level authorization (staff) | `loadTarget` + `canManage` (`users.js` 113–118, `roles.js` 63–69): School Admin limited to own school, cannot manage self or other School Admins. |
| Cross-school data (current routes) | Users list scoped (`users.js` 41–44); items and history filtered to own school (`items.js` 40, 173); audit and notifications through `visible()` (`activity.js` 28–40); SSE delivery filtered by school (`realtime.js` 27–32). **Needs runtime tests to confirm** (see checklist). |
| Function-level authorization | Every write route has `requirePage(<page>, 'f')`. Only Super Admin can edit schools; only Finance Manager can edit items; only Super Admin and School Admin can manage staff (verified from `ACCESS`). |
| Last Super Admin protection | `users.js` 145–148. |
| Error messages | Unknown errors return a generic message (`server.js` 44–45). Except S-09. |

---

## 6. Database findings

| ID | Severity | Finding | Evidence | Recommendation | Compatibility with existing data |
|---|---|---|---|---|---|
| D-01 | High | Migration imports live app code | `001` line 2 requires `src/auth/roles.js` | Freeze role list in the migration; add new migration for each role change | Safe: no data change. Edit 001 only by replacing the import with today's literal list (identical SQL). |
| D-02 | Medium | Audit and history tables are editable; cascade deletes history | `001` 52–63; `004` 45 | Revoke UPDATE/DELETE, add triggers, change cascade to RESTRICT | New migration. Existing rows untouched. |
| D-03 | Medium | `item_prices` allows invalid shapes (e.g. all three prices NULL, or both `price` and `price_boys` set) | `004` 30–41 | Add CHECK: `(price IS NOT NULL AND price_boys IS NULL AND price_girls IS NULL) OR (price IS NULL AND (price_boys IS NOT NULL OR price_girls IS NOT NULL))` | Run a SELECT first to find violating rows; current code and seed only create valid shapes. |
| D-04 | Medium | Rollback of `001` drops all tables and data; `003` down cannot restore cleaned phone numbers | `001` 66–71; `003` 13–15 | Document: in production, **never** run `npm run rollback`; fix forward with new migrations. Remove the `rollback` script from the README for production use. | Documentation only. |
| D-05 | Low | Missing indexes for frequent queries | `me.js` 26–27 (`audit_log where user_id order by at`); `session.js` / `realtime.js` (`sessions.expires_at`); notifications filter on `split_part(action, '.', 1)` | Add `audit_log(user_id, at)`, `sessions(expires_at)`, and either a stored `action_group` column or an expression index on `split_part(action,'.',1)` | Non-blocking: use `CREATE INDEX CONCURRENTLY` in production. |
| D-06 | Low | `updated_at` is set by app code only, and missed in some updates (`me.js` 86 preferences; `notifications.js` 32) | — | Add a generic `set_updated_at()` trigger | Safe. |
| D-07 | Low | Multi-school isolation is enforced only in application code | All route queries | Keep app checks. Add PostgreSQL Row-Level Security for student, guardian and finance tables when they are created (Phase 3), using `SET LOCAL app.school_id` per transaction. | Applies to new tables only. |
| D-08 | Low | Import is planned outside the transaction, then saved — another user's change in between is overwritten without warning | `items.js` 230–237 vs 283 | Use `SELECT ... FOR UPDATE` on the affected items, or compare `updated_at` (optimistic locking) and abort if changed | No schema change. |
| D-09 | Info | Money stored as `integer` TZS | `004` 33–35 | Fine for item prices (max ≈ 2.1 billion). For Finance use `bigint` minor units or `numeric(14,2)` consistently, and never floats. | New tables only. |
| D-10 | Info | `schools` has no `deactivated_at` and no route to deactivate; changing `receipt_prefix` later could break receipt numbering | `schools.js` 51–60 | Lock `receipt_prefix` once receipts exist | Rule in service layer. |

**Good database decisions (keep):** primary keys everywhere; foreign keys with sensible `RESTRICT`; unique `lower(username)`, `lower(email)`, `lower(item name)`; CHECK constraints for roles, role/school rule, phone format, categories, positive prices, students type; timestamps with time zone; `bigIncrements` for high-volume tables; transactions around multi-table writes; `publish` waits for the transaction to commit (`realtime.js` 76).

**Backup and restore — not present.** Required before real data:
- Daily `pg_dump -Fc` (encrypted, e.g. with `age` or `gpg`) kept for 30 days, plus weekly kept for 6 months, stored **off the server**.
- For Finance: continuous WAL archiving (point-in-time recovery), target RPO ≤ 15 minutes.
- A written restore procedure and a **tested restore every term** into a separate database, with the result recorded.

---

## 7. Frontend findings

| ID | Severity | Finding | Evidence | Recommendation |
|---|---|---|---|---|
| F-01 | Medium | **No tests** (no test runner, no test script) | `frontend/package.json` | Vitest + React Testing Library for components; Playwright for 5–10 key flows (login, forced password change, create staff, edit price, upload Excel, role-based sidebar). |
| F-02 | Medium | Role data duplicated from backend | `nav.js` 43–49 | See A-08. |
| F-03 | Low | Hard-coded `role === 'super'` checks | `Home.jsx`, `Staff.jsx`, `Audit.jsx` | Use `can()` / `scope`. |
| F-04 | Low | Excel upload uses raw `fetch`, bypassing the `api` wrapper (its 401 handling and error format) | `Items.jsx` line 227 | Add `api.upload(path, file)` to `api.js`. |
| F-05 | Low | No error boundary; some promises without `catch` | `main.jsx`; `Home.jsx` 56 | Add `ErrorBoundary` around routes; lint rule for floating promises (needs TypeScript or a plugin). |
| F-06 | Low | Large page files mix data loading, forms and modals | `Items.jsx` 278, `Staff.jsx` 223, `Settings.jsx` 210 | Split into feature folders (see section 9). |
| F-07 | Low | One 334 KB bundle, no route-level code splitting | build output | `React.lazy` per feature once Students/Finance are added. |
| F-08 | Info | Route protection is UI-only (routes filtered by `me.pages`) | `App.jsx` 26–35 | This is correct **as long as the backend enforces** (it does). Keep it that way; never rely on the UI. |
| F-09 | Info | Accessibility is reasonable (`aria-label`s, `role="dialog"`, `aria-modal`, `role="alert"`, Escape closes, labels on inputs) | `ui.jsx` 30–52, 104, 119 | Needs runtime check: focus trap in modals, focus return, colour contrast in dark mode, keyboard-only use. Run axe in Playwright. |
| F-10 | Info | Session state is a single `/auth/me` call held in context; signed-out event handled globally | `AuthContext.jsx`, `api.js` 21 | Good pattern. Keep. |
| F-11 | Info | No unnecessary runtime dependencies (only `react`, `react-dom`, `react-router-dom`) | `package.json` | Keep it lean. |
| F-12 | Info | `README.md` is template text; `App.css` unused | — | Replace / remove. |

---

## 8. Integration readiness (finance, banks, external services)

**Current state: not ready, and correctly not started.** There are no invoice, payment, receipt, ledger or integration tables or code. Comments refer to future receipts (`004` line 5). Good: nothing has been built in a hurry.

What must exist **before** the first payment is recorded:

### 8.1 Data model (Finance module)

- `fee_structures` (per school, academic year, class, term) and `fee_items`.
- `invoices` and `invoice_lines` — issued, never edited after issue; corrections by credit note.
- `payments` — one row per money movement reported by a channel, with `channel`, `external_reference`, `amount_minor`, `currency`, `status` (`pending`, `verified`, `rejected`), `received_at`, `verified_at`, `raw_payload_id`.
- `payment_allocations` — links a payment to one or more invoices.
- `receipts` — numbered per school using `receipt_prefix`, generated in the same transaction as the allocation, with a `UNIQUE(school_id, number)` and a gap-free sequence table.
- `refunds` with approval columns (`requested_by`, `approved_by`, CHECK `requested_by <> approved_by`).
- `ledger_entries` (double entry: every posting has equal debits and credits; enforce with a deferred constraint trigger per journal). Posted entries are **append-only**; reversals are new entries.
- `bank_statements` and `reconciliation_matches`.
- `integration_events` (raw inbound webhook/callback bodies, stored before processing).

### 8.2 Mandatory controls

| Control | How |
|---|---|
| Never trust the browser | A payment becomes `verified` only after the backend confirms it with the bank/provider API or a signed callback. |
| Webhook authenticity | Verify the signature or mutual-TLS exactly as the selected bank documents it. Reject unsigned or old (timestamp) messages. Store the raw body first. **No bank API contract is assumed in this report.** |
| Idempotency | `UNIQUE(channel, external_reference)` on `payments`; an `Idempotency-Key` header for internal POSTs that create money records; process callbacks with `INSERT ... ON CONFLICT DO NOTHING`. |
| Transactions | Payment + allocation + receipt + ledger in one database transaction, `SERIALIZABLE` or with row locks on the invoice. |
| Outbound calls | Use an outbox table: write "call the bank" inside the transaction, send it from a background job, retry safely. |
| Separation of duties | The person who records or approves a refund cannot be the one who reconciles it. Enforced in the service and by a CHECK constraint. |
| Secrets | Bank keys and certificates in a secret store or protected environment file on the server, never in git; rotate on staff change. |
| Audit | Every financial action writes to the append-only audit log with before/after values. |
| Reconciliation | Daily job compares verified payments with the bank statement; differences go to an exceptions list that a human must close. |
| Data protection | Tanzania Personal Data Protection Act 2022: decide controller/processor roles, register with the PDPC if required, keep a record of processing, limit who sees guardian and child data. (Legal advice needed; this report does not give it.) |

### 8.3 Integration adapter shape

```
integrations/
  banks/
    bank-adapter.js        # the interface our code calls:
                           #   verifyPayment(ref), parseCallback(req), fetchStatement(date)
    <bank-name>/           # one folder per bank, written from that bank's documentation
  sms/  email/
```

Business modules call the adapter interface, never a bank SDK directly. This lets you test Finance with a fake adapter.

---

## 9. Recommended target folder structure

Kept intentionally small. Same modular-monolith idea as the baseline, with fewer empty layers.

### Backend

```
backend/
├── migrations/                   # frozen history, no app imports
├── seeds/
│   ├── dev/                      # demo data, never in production
│   └── prod/                     # only schools; admin created by a one-time CLI command
├── scripts/
│   └── create-admin.js           # prints a one-time random password
├── src/
│   ├── server.js                 # starts HTTP + realtime listener (only entry point)
│   ├── app.js                    # builds the Express app (used by tests)
│   ├── config/
│   │   └── env.js                # validated settings; refuses unsafe production values
│   ├── infrastructure/
│   │   ├── db.js
│   │   ├── logger.js             # pino with redaction
│   │   ├── realtime.js           # SSE + LISTEN/NOTIFY (current file, plus limits)
│   │   └── excel.js              # read/write helpers with size guards
│   ├── middleware/
│   │   ├── security.js           # helmet, origin check, rate limits
│   │   ├── auth.js               # loadUser, requireAuth, requirePermission
│   │   ├── validate.js           # schema validation
│   │   └── errors.js             # HttpError + DB error mapping
│   ├── shared/
│   │   ├── permissions.js        # roles, permissions, page access (from roles.js)
│   │   ├── phone.js
│   │   └── money.js
│   └── modules/
│       ├── auth/        auth.routes.js  auth.service.js  auth.schema.js  password.js  session.repository.js
│       ├── users/       users.routes.js users.service.js users.schema.js
│       ├── schools/     schools.routes.js schools.service.js schools.schema.js
│       ├── me/          me.routes.js me.service.js
│       ├── audit/       audit.routes.js audit.service.js activity-groups.js
│       ├── notifications/ notifications.routes.js
│       ├── library/     items.routes.js items.service.js items.repository.js items.schema.js items.import.js
│       ├── students/    (Phase 4)
│       ├── academics/   (Phase 4)
│       └── finance/     (Phase 5: invoices, payments, receipts, refunds, ledger, reconciliation)
├── integrations/                 # Phase 5: banks/, sms/, email/
└── test/
    ├── unit/
    ├── integration/              # supertest + real PostgreSQL (Testcontainers or a CI service DB)
    └── security/                 # authz matrix, enumeration, CSRF, headers
```

### Frontend

```
frontend/src/
├── main.jsx
├── app/            App.jsx  routes.jsx  providers.jsx  ErrorBoundary.jsx
├── core/
│   ├── api/        client.js (fetch wrapper incl. upload)
│   ├── auth/       AuthContext.jsx  useCan.js
│   ├── live/       live.js
│   └── prefs/      prefs.js
├── components/     ui.jsx split into Button, Modal, Panel, Toast, ExcelButton ...
├── layouts/        Shell.jsx  Bell.jsx  ScopeProvider.jsx
├── features/
│   ├── auth/       Login, ChangePassword
│   ├── home/
│   ├── staff/      StaffPage, StaffForm, CredentialsModal, staff.api.js
│   ├── schools/
│   ├── activity/   (Audit)
│   ├── library/    ItemsPage, ItemForm, PriceHistory, ExcelUpload, items.api.js
│   ├── account/    Profile, Settings, Devices
│   └── (students, academics, finance, reports later)
├── styles/         index.css split by area when it grows
└── test/
```

---

## 10. File-by-file refactoring plan

No behaviour changes in these steps unless marked **(security fix)**. Each step should be its own small PR with tests.

| Current file | Action | Target |
|---|---|---|
| `backend/server.js` | Delete after `package.json` `main`/`start` point to `src/server.js`. Update docs. | — |
| `backend/src/server.js` | Split: app building → `src/app.js`; start-up → `src/server.js`. Headers → `middleware/security.js` with helmet **(security fix S-07)**. Health reply generic **(S-09)**. Trust proxy from config **(S-02)**. Error handler → `middleware/errors.js` + DB code mapping (A-04). | `src/app.js`, `src/server.js`, `middleware/*` |
| `backend/knexfile.js` | Read from `config/env.js`; no `postgres` default in production **(S-03)**; add `ssl` option. | same file |
| `backend/src/db.js` | Move. | `infrastructure/db.js` |
| `backend/src/realtime.js` | Move; add per-session/per-user limits **(S-11)**. | `infrastructure/realtime.js` |
| `backend/src/auth/roles.js` | Move; add named permissions (A-10). Keep `ACCESS` derived. | `shared/permissions.js` |
| `backend/src/auth/session.js` | Split: middleware (`loadUser`, `requireAuth`, `requirePermission`) → `middleware/auth.js`; session create/end → `modules/auth/session.repository.js`; `publicUser` → `modules/users/users.mapper.js`. Cookie options from config, `__Host-` prefix, idle timeout **(S-08, S-17)**. | as listed |
| `backend/src/routes/auth.js` | Thin routes; login logic → `auth.service.js` with dummy-hash compare and uniform errors **(S-05)** and progressive delay **(S-04)**; log failed logins **(S-14)**. | `modules/auth/*` |
| `backend/src/routes/me.js` | Thin routes + `me.service.js`; schema for preferences and contact. | `modules/me/*` |
| `backend/src/routes/users.js` | Service for create/edit/reset/switch; schema validation; temp password expiry **(S-13)**. Export stays. | `modules/users/*` |
| `backend/src/routes/schools.js` | Service + schema; split public directory vs admin details **(S-15)**. | `modules/schools/*` |
| `backend/src/routes/audit.js` | Move; filters through schema. | `modules/audit/audit.routes.js` |
| `backend/src/routes/notifications.js` | Move. | `modules/notifications/` |
| `backend/src/routes/items.js` | Split into routes, service (`readBody` + `savePrices` + one shared price validator used by both form and import), repository, import planner. Restrict raw body type **(S-06)**, size guards **(S-10)**, optimistic locking (D-08). | `modules/library/*` |
| `backend/src/lib/util.js` | Split: `HttpError` → `middleware/errors.js`; `sha256` → `shared/crypto.js`; `tempPassword`, `checkPassword` → `modules/auth/password.js` **(S-13)**; `tzPhone` → `shared/phone.js`; `suggestUsername` → `modules/users/`; `audit()` → `modules/audit/audit.service.js`. | as listed |
| `backend/src/lib/activity.js` | Move. | `modules/audit/activity-groups.js` |
| `backend/src/lib/excel.js` | Move; add streaming reader limits **(S-10)** and formula guard **(S-18)**. | `infrastructure/excel.js` |
| `migrations/20261110_001_core_accounts.js` | Replace the `require('../src/auth/roles')` with the literal lists (same SQL output). | same file |
| new migrations | `006_audit_protection` (S-12/D-02), `007_item_price_shape` (D-03), `008_indexes` (D-05), `009_temp_password_expiry` (S-13), `010_updated_at_trigger` (D-06). | `migrations/` |
| `seeds/01_schools_and_super_admin.js` | Keep schools; remove admin creation and default password **(S-01)**. | `seeds/prod/01_schools.js` + `scripts/create-admin.js` |
| `seeds/02_library_items.js` | Real business data from the sales book: keep, but mark as a one-time data import, not a dev seed. | `seeds/prod/02_library_items.js` |
| `backend/.env.example` | Remove password value; add `TRUST_PROXY`, `COOKIE_SECURE`, `APP_ORIGIN`, `LOG_LEVEL`. | same file |
| `README.md` | Remove default password **(S-01)**; link to new docs. | same file |
| `docs/running-locally.md` | Fix default-port statement (A-05). | same file |
| `frontend/src/api.js` | Add `upload()`; optional custom CSRF header **(S-06)**. | `core/api/client.js` |
| `frontend/src/nav.js` | Remove role constants (A-08); keep menu. | `app/nav.js` |
| `frontend/src/auth/AuthContext.jsx` | Move; expose `useCan`. | `core/auth/` |
| `frontend/src/live.js`, `prefs.js` | Move. | `core/live/`, `core/prefs/` |
| `frontend/src/components/ui.jsx` | Split into small files when touched. | `components/*` |
| `frontend/src/layout/*` | Move. | `layouts/*` |
| `frontend/src/pages/*.jsx` | Move to `features/<name>/`; split `Items.jsx`, `Staff.jsx`, `Settings.jsx` into page + form + modal files. Replace `role === 'super'` checks (A-09). | `features/*` |
| `frontend/index.html` | Move inline theme script to `public/theme-boot.js` (needed for strict CSP). | same + new file |
| `frontend/src/App.css`, `frontend/README.md` | Delete / rewrite. | — |
| Root prototypes and PDF | Move. | `docs/prototypes/`, `docs/concept/` |

---

## 11. Prioritized implementation roadmap

| Phase | Goal | Work items | Done when |
|---|---|---|---|
| **0 — Audit** | (this report) | — | Reviewed and agreed by the team |
| **1 — Security hardening** (≈1–2 weeks) | Close Critical/High; quick Mediums | S-01, S-02, S-03, S-09, S-07 (helmet + CSP), S-08, S-05, S-04, S-06, S-11, S-12 (DB permissions + triggers), S-13 (expiry + length), D-01 | All tests in section 12 "Phase 1 gate" pass in CI |
| **1b — Test and CI foundation** (in parallel) | Safety net before refactoring | Vitest/Jest + supertest backend tests; Playwright smoke tests; GitHub Actions running lint, build, tests, `npm audit --omit=dev`, gitleaks secret scan; Dependabot | CI is required for merging to `main` |
| **2 — Architecture refactoring** (≈2–3 weeks) | Clean module boundaries, no behaviour change | `app.js`/`server.js`, config validation, logger, validation middleware, error mapping, `items` split, `util.js` split, frontend feature folders, single role source, named permissions, docs (architecture, API with OpenAPI, environment variables) | Same tests pass; no route over ~150 lines; services unit-tested |
| **3 — Database engineering** | Ready for students and money | D-03 … D-08; backup + tested restore; least-privilege roles finalised; academic year / term / class / stream tables designed; RLS design for sensitive tables; data-protection decisions (retention, access) | Restore drill recorded; schema review signed off |
| **4 — Core school operations** | Students, guardians, staff HR, attendance, exams, academic tracker | Built on the new module template, each with tests and authz matrix | Per-module acceptance tests |
| **5 — Finance and banking** | Fees, invoices, payments, receipts, ledger, refunds, reconciliation, bank adapter | Section 8 controls; MFA for finance roles; separation of duties; outbox; bank sandbox testing using the chosen bank's documentation | Finance acceptance criteria (section 12) pass; external security review |
| **6 — Analytics** | Performance tracking, weak topics, management reports | Read-only reporting queries or views | Reports match source data in tests |
| **7 — Production readiness** | Operate safely | Deployment guide (Nginx, TLS, PM2/systemd), monitoring and alerts (e.g. Sentry or self-hosted), uptime checks, load test (SSE + login), OWASP ZAP scan, penetration test, incident and breach-response procedure | Go-live checklist signed |

**Rule from the baseline that I fully support:** do not build new business modules (Students, Finance) until Phase 1 and the CI foundation are done.

---

## 12. Testing and security acceptance criteria

### Phase 1 gate (must pass before any production deployment)

1. No string `Musabe@2026` anywhere in the repository; seed without admin password fails or prints a random one.
2. With production config, faked `X-Forwarded-For` does not change rate-limit identity.
3. App database role cannot `UPDATE`/`DELETE` `audit_log`, cannot `CREATE` tables, and is not a superuser.
4. Login: unknown user, wrong password and locked account return identical status, body and (within 20 ms median) timing.
5. 20 failed logins from an attacker do not stop the real user signing in.
6. Non-GET request with foreign `Origin` → 403.
7. Response headers include CSP, HSTS (HTTPS), `X-Content-Type-Options`, `frame-ancestors 'none'`, `Referrer-Policy`, `Permissions-Policy`.
8. Session cookie has `__Host-` prefix, `Secure`, `HttpOnly`, `SameSite=Lax` in production; HTTP redirects to HTTPS.
9. `/api/health` reveals no error text.
10. Zip-bomb and 3,001-row uploads are rejected quickly without memory spike.
11. 11th SSE connection for one user is refused or replaces the oldest.
12. Temporary password older than 72 h cannot be used.

### Authorization matrix test (automated, every release)

For **each of the 14 roles** × **each API route** × **own school / other school**: expected status (200/403/404) is listed in a table in the test suite and checked automatically. Includes:
- A School Admin of school A cannot read, edit or reset users of school B.
- A Bursar of school A cannot see prices, history or audit entries of school B.
- A teacher cannot reach `/api/users`, `/api/audit` details outside "academic", or item writes.
- Only Finance Manager can write items; only Super Admin can write schools.
- Live events for school A never reach a school-B staff connection.

### Code quality criteria

- CI runs: backend lint, frontend lint, frontend build, all tests, `npm audit --omit=dev` (fail on High+), secret scan. Required to merge.
- Backend service-layer test coverage ≥ 80% for auth, users, items; ≥ 90% for finance when built.
- Every migration has a test that runs `migrate:latest` on an empty database in CI.
- No route handler longer than ~40 lines; no file over ~300 lines without a reason.

### Finance acceptance criteria (Phase 5)

- Same bank callback delivered 5 times → exactly one payment and one receipt.
- Process killed between payment insert and receipt → no half-written records (transaction).
- Ledger: for every journal, sum(debit) = sum(credit), enforced by the database.
- Posted ledger entries cannot be updated or deleted by the app role.
- A refund cannot be approved by the person who requested it.
- Daily reconciliation report lists every unmatched item; nothing is auto-cleared.
- Restore of last night's backup reproduces the same totals.

### Operations criteria

- Backup restore tested each term, with written result.
- Error monitoring alerts within 5 minutes of repeated 500s.
- Security events (failed logins, 403 spikes, lockouts) visible to administrators.

---

*End of report. Companion file: `docs/security-checklist.md`.*
