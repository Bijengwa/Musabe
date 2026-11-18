# Musabe Schools System — Security Verification Checklist

> **Update 16 November 2026 (attack run):** rows changed: 4.6 (zip sizes are now measured, not believed: a file that lies about its size is refused), 5.2 (X-Forwarded-Host no longer believed; production accepts only APP_ORIGIN), 4.2 (bad values now answer 400 instead of 500), 1.7 (change-password tries limited to 10 per 15 minutes), 3.8 (other schools' School Admin names hidden from school staff). New module (barcodes, main store, issuing, purchases, weekly check) is covered by `test/store.test.js`: role checks, school isolation, no-change / no-delete database guards. Details: `docs/progress.md` → "Attack run".

> **Update 14 November 2026:** security batch 2 (migration 013, `lib/guard.js`, `lib/reminders.js`, `test/security.test.js`). Rows changed: 1.3, 1.4, 1.6, 1.9, 1.11, 1.12, 2.6, 2.8, 2.10, 2.13, 3.8, 3.11, 3.12, 4.5, 4.6, 4.8, 4.10, 5.2, 5.4, 5.5, 5.9, 6.5, 7.2, 7.4, 7.5, 7.6, 7.7, 8.2, 8.4, 9.3. Still open: MFA (1.15), schema validation library (4.2), structured logs/alerting/monitoring (7.8–7.10), backups and restore (10.7–10.8), CI and dependency scanning, RLS (3.13).

Commit `f44a4f9` · branch `library-items-excel-notifications` · 11 November 2026 · **amended after Phase 1 fixes (working tree, not yet committed)**

> Phase 1 changed rows 1.1, 1.10, 6.3, 7.4, 8.1, 9.2, 9.5, 10.1, 10.2, 10.5-note and 12.1. "Verified (test DB)" means the test was run on a throwaway PostgreSQL, not on the real database. Rows marked 🔍 still need checking on the real server after deployment.

Reference: OWASP ASVS 5.0 (target Level 2) and OWASP API Security Top 10 (2023). Details and fixes for each finding are in `docs/architecture-audit.md`.

**Status meanings**

| Status | Meaning |
|---|---|
| ✅ Verified | Checked in the code (and by a small test where noted). Works as required. |
| ❌ Failed | The control exists but does not meet the requirement. |
| ⛔ Not implemented | The control does not exist. |
| 🔍 Requires runtime verification | Cannot be decided from code alone. Needs a running system, database or deployment. |

Update this file after every fix: change the status, add the PR number and the test that proves it.

---

## 1. Authentication

| # | Requirement | Status | Evidence / note | Finding |
|---|---|---|---|---|
| 1.1 | No default or published credentials | ✅ Verified (test DB) | Phase 1: no fallback in the seed; password removed from README and `.env.example`; seed stops without a strong `SUPERADMIN_PASSWORD` (tested) | S-01 |
| 1.2 | Passwords hashed with a strong adaptive algorithm | ✅ Verified | bcrypt cost 12 (`auth.js` 63, `users.js` 104, 170) | — |
| 1.3 | Minimum length ≥ 12 (ASVS L2 recommendation), maximum ≥ 64, no composition rules | ✅ Verified (tests) | 2026-11-14: at least 12 characters, no symbol rules, phrases encouraged (`util.js` checkPassword; `test/security.test.js`) | S-13 |
| 1.4 | Common / breached passwords blocked | ✅ Verified (tests) | Common words/numbers and the person's own name/username are taken out; what is left must be ≥ 6 characters | S-13 |
| 1.5 | Temporary passwords are random and single use | ✅ Verified | `crypto.randomInt` (`util.js` 13–17); forced change (`session.js` 66–72) | — |
| 1.6 | Temporary passwords expire | ✅ Verified (tests) | `users.temp_password_expires_at` (72 h, `TEMP_PASSWORD_HOURS`); expired = refused at sign-in | S-13 |
| 1.7 | Password change requires current password | ✅ Verified | `auth.js` 56 | — |
| 1.8 | Password change signs out other sessions | ✅ Verified | `auth.js` 69 | — |
| 1.9 | Brute-force protection per account | ✅ Verified (tests) | 5 wrong from one address locks only that address for 15 min; 20 wrong from anywhere locks the account and tells Super Admin | S-04 |
| 1.10 | Brute-force protection per client | ✅ Verified (tests) / 🔍 production Nginx | Phase 1: forged `X-Forwarded-For` no longer resets the login limit (`test/proxy-ip*.test.js`). Per-account lockout abuse (1.9) still open | S-02 |
| 1.11 | No account enumeration through messages | ✅ Verified (tests) | Same 401 reply for unknown user, wrong password and lock | S-05 |
| 1.12 | No account enumeration through timing | ✅ Verified (code) | Unknown usernames are checked against a dummy bcrypt hash (same time) | S-05 |
| 1.13 | "Forgot password" does not reveal if user exists | ✅ Verified | Same reply always (`auth.js` 86) | — |
| 1.14 | Password reset does not send secrets by SMS/email; identity checked | ✅ Verified (design) / 🔍 procedure | Admin hands over in person; procedure must be written | S-16 |
| 1.15 | MFA for privileged and finance roles | ⛔ Not implemented | | S-04, S-13 |
| 1.16 | Switched-off accounts cannot sign in | ✅ Verified | `auth.js` 33; `loadUser` checks `active` (`session.js` 58) | — |

## 2. Session management

| # | Requirement | Status | Evidence / note | Finding |
|---|---|---|---|---|
| 2.1 | Session token has ≥ 128 bits of randomness | ✅ Verified | 32 bytes (`session.js` 21) | — |
| 2.2 | Token stored only as hash on server | ✅ Verified | SHA-256 (`session.js` 24, 54) | — |
| 2.3 | New token at login (no session fixation) | ✅ Verified | `startSession` always creates a new token | — |
| 2.4 | Logout destroys server session | ✅ Verified | `session.js` 35 | — |
| 2.5 | Cookie `HttpOnly` | ✅ Verified | `session.js` 13 | — |
| 2.6 | Cookie `Secure` always in production | ✅ Verified (code) | Secure when `NODE_ENV=production` or `COOKIE_SECURE=true`; production also refuses to start without an https `APP_ORIGIN` | S-08 |
| 2.7 | Cookie `SameSite` set | ✅ Verified | `Lax` (`session.js` 14) | — |
| 2.8 | `__Host-` cookie prefix | ✅ Verified (code) | `__Host-musabe_sid` whenever the cookie is Secure | S-08 |
| 2.9 | Absolute session timeout | ✅ Verified | 12 h / 30 days (`session.js` 9–10) | — |
| 2.10 | Idle timeout | ✅ Verified (tests) | 2 h idle (`SESSION_IDLE_MINUTES`), 7 days with "Keep me signed in" | S-17 |
| 2.11 | Sessions ended on password reset / switch-off, including live screens | ✅ Verified | `endAllSessions` (`session.js` 40–44); `checkSessions` (`realtime.js` 41–49) | — |
| 2.12 | User can see and end own sessions | ✅ Verified | `me.js` 93–126 | — |
| 2.13 | Expired sessions removed | ✅ Verified (code) | `cleanSessions()` every hour | S-17 |

## 3. Authorization and data isolation

| # | Requirement | Status | Evidence / note | Finding |
|---|---|---|---|---|
| 3.1 | Every API route requires sign-in except login, logout, forgot, health | ✅ Verified | `router.use(requireAuth)` in all route files | — |
| 3.2 | Function-level checks on every write route | ✅ Verified | `requirePage(page, 'f')` on all POST/PATCH (users, schools, items) | — |
| 3.3 | Object-level checks on staff accounts | ✅ Verified | `loadTarget` + `canManage` (`users.js` 113–118) | — |
| 3.4 | School Admin limited to own school | ✅ Verified (code) / 🔍 runtime | `roles.js` 67; `users.js` 92 | — |
| 3.5 | School staff see only own school's prices and history | ✅ Verified (code) / 🔍 runtime | `items.js` 40, 44, 173 | — |
| 3.6 | Activity and notifications limited by role and school | ✅ Verified (code) / 🔍 runtime | `activity.js` 28–40 | — |
| 3.7 | Live events only reach allowed users | ✅ Verified (code) / 🔍 runtime | `realtime.js` 27–32; events carry no data | — |
| 3.8 | Minimum data exposure on school list | ✅ Verified (tests) | Staff counts and School Admin names only for roles with the Schools or Staff page | S-15 |
| 3.9 | Cannot remove last Super Admin | ✅ Verified | `users.js` 145–148 | — |
| 3.10 | Users cannot change own role, name, school | ✅ Verified | `me.js` 13, 42–48 | — |
| 3.11 | Automated authorization matrix test (all roles × routes × schools) | ✅ Verified (tests) | `test/security.test.js`: 14 roles × 13 routes | Q-01 |
| 3.12 | Separation of duties for finance actions | ✅ Partly | Damaged/lost: only FM or Accountant approves, never their own report; daily money checks cannot be changed; receipts/bills locked by triggers. Open: a bursar can mark their own control number paid | §8 |
| 3.13 | Database-level isolation (RLS) for sensitive tables | ⛔ Not implemented | Planned for student/finance tables | D-07 |

## 4. Input validation and injection

| # | Requirement | Status | Evidence / note | Finding |
|---|---|---|---|---|
| 4.1 | SQL queries parameterized | ✅ Verified | All `whereRaw`/`raw` use bindings | — |
| 4.2 | Schema validation on every endpoint | ❌ Failed | Hand-written checks; some `NaN` reach SQL (`users.js` 50) | A-03 |
| 4.3 | Output encoding against XSS | ✅ Verified | React escaping; no `dangerouslySetInnerHTML` in `frontend/src` | — |
| 4.4 | Request body size limits | ✅ Verified | JSON 1 MB (`server.js` 11); upload 5 MB (`items.js` 226) | — |
| 4.5 | Upload content type restricted | ✅ Verified (tests) | Uploads must start with the zip signature (`excel.js` checkXlsx) | S-06 |
| 4.6 | Upload decompressed size / resource limits | ✅ Verified (tests) | Zip central directory read first: ≤ 60 MB unpacked, ≤ 3000 parts | S-10 |
| 4.7 | Upload row limit | ✅ Verified (exists) / ❌ Failed (late) | Checked after full parse (`items.js` 229) | S-10 |
| 4.8 | Upload frequency limit | ✅ Verified (code) | 20 uploads per person per 10 min (`guard.js` uploadLimit) | S-10 |
| 4.9 | Spreadsheet formula injection in exports | ✅ Verified (not exploitable in .xlsx today) | Tested: ExcelJS writes `=...` as string cell | S-18 |
| 4.10 | Formula guard for future CSV/formula exports | ✅ Verified (tests) | Text starting with = + @ or -letter gets a leading ' in every Excel download | S-18 |
| 4.11 | Hostile Excel file tests (malformed, zip bomb, huge sheet) | 🔍 Requires runtime verification | | S-10 |

## 5. CSRF and browser security

| # | Requirement | Status | Evidence / note | Finding |
|---|---|---|---|---|
| 5.1 | No state change on GET | ✅ Verified | All changes are POST/PATCH/PUT | — |
| 5.2 | CSRF token or Origin/Referer validation | ✅ Verified (tests) | `guard.js` sameOrigin: Origin / Sec-Fetch-Site checked on every change | S-06 |
| 5.3 | CORS not open | ✅ Verified | No CORS middleware (same-origin only) | — |
| 5.4 | Content-Security-Policy | ✅ API (tests) / 🔍 page | API replies: `default-src 'none'`. The page CSP is set in Nginx: see `docs/deployment.md` | S-07 |
| 5.5 | HSTS | ✅ Verified (code) | HSTS when Secure cookies are on | S-07 |
| 5.6 | `X-Content-Type-Options: nosniff` | ✅ Verified | `server.js` 14 (API only) | — |
| 5.7 | Clickjacking protection | ✅ Verified (API) / 🔍 (HTML page) | `X-Frame-Options: DENY` set by Express; HTML is served by Vite/Nginx | S-07 |
| 5.8 | `Referrer-Policy` | ✅ Verified (API) | `same-origin` | — |
| 5.9 | `Permissions-Policy`, COOP | ✅ Verified (tests) | Permissions-Policy, COOP, CORP, Cache-Control: no-store | S-07 |
| 5.10 | `X-Powered-By` removed | ✅ Verified | `server.js` 10 | — |

## 6. Transport security

| # | Requirement | Status | Evidence / note | Finding |
|---|---|---|---|---|
| 6.1 | HTTPS only, HTTP redirected | 🔍 Requires runtime verification | No code or deployment config in repo | S-08 |
| 6.2 | TLS 1.2+ with modern ciphers | 🔍 Requires runtime verification | Proxy config not in repo | — |
| 6.3 | Trusted proxy configured exactly | ✅ Verified (tests) / 🔍 production | Phase 1: `TRUST_PROXY` (default loopback); `true` and hop counts refused. Tests fail on the old setting and pass on the new | S-02 |
| 6.4 | Node not reachable directly from the internet | 🔍 Requires runtime verification | | S-02 |
| 6.5 | Database connection encrypted (if remote) | ✅ Option | `DATABASE_SSL=true` (+ `DATABASE_SSL_CA`); production refuses a remote database without it | S-03 |

## 7. Error handling, logging and audit

| # | Requirement | Status | Evidence / note | Finding |
|---|---|---|---|---|
| 7.1 | Generic errors to users for unexpected failures | ✅ Verified | `server.js` 44–45 | — |
| 7.2 | No internal details on public endpoints | ✅ Verified (tests) | `/api/health` returns only ok/database | S-09 |
| 7.3 | Business actions written to audit log in same transaction | ✅ Verified | `audit(..., trx)` across routes | — |
| 7.4 | Audit log append-only at database level | ✅ Verified (tests) | Triggers (migration 013) refuse UPDATE/DELETE on audit_log for every account | S-12 |
| 7.5 | Price history cannot be deleted | ✅ Verified | FK changed to RESTRICT + triggers (migration 013) | S-12 |
| 7.6 | Failed logins logged | ✅ Verified (tests) | `auth.login_failed` for known usernames | S-14 |
| 7.7 | Authorization failures logged | ✅ Verified (tests) | `auth.denied`, once per person/page/10 min | S-14 |
| 7.8 | Structured logs with request id and secret redaction | ⛔ Not implemented | `console.error` only | A-11 |
| 7.9 | Security alerting | ⛔ Not implemented | | A-11 |
| 7.10 | Error monitoring service | ⛔ Not implemented | | Q |

## 8. API abuse and denial of service

| # | Requirement | Status | Evidence / note | Finding |
|---|---|---|---|---|
| 8.1 | Rate limit on login and forgot | ✅ Verified (tests) | Phase 1: limit keyed on the resolved client IP; cannot be bypassed with forged headers | S-02 |
| 8.2 | General API rate limit | ✅ Verified (code) | 600 requests/min per person or address (`API_RATE_LIMIT`) | — |
| 8.3 | Limits on list sizes | ✅ Verified (partly) | Audit max 1000 / export 20000; users and items unpaginated (small today) | — |
| 8.4 | Real-time connection limits | ✅ Verified (code) | 8 live connections per person, 2000 per server | S-11 |
| 8.5 | Load test of login and SSE | 🔍 Requires runtime verification | | — |

## 9. Secrets and configuration

| # | Requirement | Status | Evidence / note | Finding |
|---|---|---|---|---|
| 9.1 | `.env` not committed (now or in history) | ✅ Verified | `.gitignore`; git history search found no `.env` | — |
| 9.2 | No secrets in source or docs | ✅ Verified | Phase 1: the published default password no longer appears in any tracked file (searched) | S-01 |
| 9.3 | Configuration validated at start; unsafe production values refused | ✅ Verified (code) | `guard.js` checkConfig at start | A-06 |
| 9.4 | Secret scanning in CI | ⛔ Not implemented | No CI | Q |
| 9.5 | Rotation of credentials used during development | 🔍 Requires runtime verification (owner action) | A count-only search (contents not shown) found the old default password still in the local `backend/.env`. Treat it as public: confirm the Super Admin password was changed on every database where the seed ran, and remove `SUPERADMIN_PASSWORD` from `.env` | S-01 |

## 10. Database security and integrity

| # | Requirement | Status | Evidence / note | Finding |
|---|---|---|---|---|
| 10.1 | App uses a least-privilege DB role | ✅ Verified (test DB) / 🔍 production not yet applied | Phase 1: `musabe_app` with table-by-table rights (`backend/db/provision-roles.sql`); app refuses to start in production as superuser or table owner (tested) | S-03 |
| 10.2 | Separate migration role and runtime role | ✅ Verified (test DB) / 🔍 production not yet applied | Phase 1: `musabe_owner` runs migrations (tested: roll back all + migrate); `musabe_app` is refused | S-03 |
| 10.3 | Primary/foreign keys and core CHECK constraints | ✅ Verified | Migrations 001–005 | — |
| 10.4 | Item price shape constraint | ⛔ Not implemented | | D-03 |
| 10.5 | Migrations independent of app code | ❌ Failed | `001` imports `roles.js` | D-01 |
| 10.6 | Safe rollback policy documented | ⛔ Not implemented | `001` down drops everything | D-04 |
| 10.7 | Encrypted, off-site backups | ⛔ Not implemented | | §6 |
| 10.8 | Tested restore | ⛔ Not implemented | | §6 |

## 11. Dependencies and supply chain

| # | Requirement | Status | Evidence / note | Finding |
|---|---|---|---|---|
| 11.1 | No known High/Critical vulnerabilities in production deps | ✅ Verified | `npm audit`: backend 2 moderate (exceljs→uuid), none High | S-19 |
| 11.2 | Moderate advisories reviewed | 🔍 Requires runtime verification | Confirm ExcelJS never calls uuid v3/v5/v6 with a buffer | S-19 |
| 11.3 | Lock files committed | ✅ Verified | Both `package-lock.json` tracked | — |
| 11.4 | Automated dependency updates / scanning | ⛔ Not implemented | No Dependabot/Renovate/CI | Q |
| 11.5 | Minimal dependency set | ✅ Verified | 8 backend, 3 frontend runtime deps; none unused | — |

## 12. Quality assurance and DevSecOps

| # | Requirement | Status | Evidence / note |
|---|---|---|---|
| 12.1 | Backend automated tests | ✅ Verified (Phase 1 scope only) | `npm test`: proxy/IP and database-account tests. Everything else still untested |
| 12.2 | Frontend automated tests | ⛔ Not implemented | No test script or folder |
| 12.3 | Backend linting | ⛔ Not implemented | No ESLint config in `backend/` |
| 12.4 | Frontend linting | ✅ Verified | `eslint .` passes with 0 problems |
| 12.5 | Frontend build | ✅ Verified | `vite build` passes |
| 12.6 | Backend syntax check | ✅ Verified | `node --check` passes on all files |
| 12.7 | No circular dependencies | ✅ Verified | `madge --circular` on both apps |
| 12.8 | CI/CD pipeline | ⛔ Not implemented | No `.github/workflows` |
| 12.9 | Environment validation | ⛔ Not implemented | — |
| 12.10 | Deployment documentation | ⛔ Not implemented | Only local setup docs (and one wrong port statement) |
| 12.11 | Backup procedure documentation | ⛔ Not implemented | — |
| 12.12 | Error monitoring | ⛔ Not implemented | — |

## 13. Financial controls (for Phase 5 — none built yet)

All items below are ⛔ **Not implemented** because the Finance module does not exist. They are listed so they are designed in from the start.

| # | Requirement |
|---|---|
| 13.1 | Payment marked successful only after server-side verification with the bank/provider |
| 13.2 | Webhook/callback authenticity verified exactly per the selected bank's documentation |
| 13.3 | Raw callback stored before processing |
| 13.4 | Idempotency: unique external reference + idempotency keys |
| 13.5 | Payment, allocation, receipt and ledger posting in one transaction |
| 13.6 | Double-entry ledger; debits = credits enforced in the database |
| 13.7 | Posted entries immutable; corrections by reversal |
| 13.8 | Gap-free receipt numbering per school |
| 13.9 | Refund maker ≠ checker |
| 13.10 | Daily bank reconciliation with human-closed exceptions |
| 13.11 | Integration secrets outside git; rotation procedure |
| 13.12 | MFA for finance roles |
| 13.13 | No storage of card numbers, CVV or bank passwords |

## 14. Privacy (Tanzania PDPA 2022)

| # | Requirement | Status |
|---|---|---|
| 14.1 | Controller/processor roles and PDPC registration decided | 🔍 Requires verification (legal/organisational) |
| 14.2 | Retention and deletion rules for student, guardian and staff data | ⛔ Not implemented |
| 14.3 | Access to sensitive records logged | ⛔ Not implemented (read access is not audited) |
| 14.4 | Breach response procedure | ⛔ Not implemented |
| 14.5 | Need-to-know access (teacher ≠ finance data, accountant ≠ discipline data) | 🔍 Design for Phase 3–4 |

---

## Overall

Some rows carry two statuses (for example "exists but bypassable"). Treat any row with ❌ or ⛔ as open.

**Overall:** the application has a good set of basic controls, but it **must not be called secure** yet. The Phase 1 gate in `architecture-audit.md` §12 lists what must pass before production.
