# Musabe Schools System — Security Verification Checklist

Commit `f44a4f9` · branch `library-items-excel-notifications` · 11 November 2026

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
| 1.1 | No default or published credentials | ❌ Failed | `Musabe@2026` in seed line 19, `.env.example` 15, `README.md` 35 | S-01 |
| 1.2 | Passwords hashed with a strong adaptive algorithm | ✅ Verified | bcrypt cost 12 (`auth.js` 63, `users.js` 104, 170) | — |
| 1.3 | Minimum length ≥ 12 (ASVS L2 recommendation), maximum ≥ 64, no composition rules | ❌ Failed | 8 characters + letter + digit (`util.js` 31–35) | S-13 |
| 1.4 | Common / breached passwords blocked | ⛔ Not implemented | | S-13 |
| 1.5 | Temporary passwords are random and single use | ✅ Verified | `crypto.randomInt` (`util.js` 13–17); forced change (`session.js` 66–72) | — |
| 1.6 | Temporary passwords expire | ⛔ Not implemented | No expiry column | S-13 |
| 1.7 | Password change requires current password | ✅ Verified | `auth.js` 56 | — |
| 1.8 | Password change signs out other sessions | ✅ Verified | `auth.js` 69 | — |
| 1.9 | Brute-force protection per account | ✅ Verified (exists) / ❌ Failed (abusable) | 5 tries → 15 min lock (`auth.js` 14–31); can be used to lock others | S-04 |
| 1.10 | Brute-force protection per client | ❌ Failed | Rate limit exists (`auth.js` 11) but IP can be faked | S-02 |
| 1.11 | No account enumeration through messages | ❌ Failed | 423 "locked" reply only for real users (`auth.js` 22–23) | S-05 |
| 1.12 | No account enumeration through timing | 🔍 Requires runtime verification | Code skips bcrypt for unknown users (`auth.js` 21) — likely fails | S-05 |
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
| 2.6 | Cookie `Secure` always in production | ❌ Failed | Depends on `NODE_ENV` (`session.js` 15) | S-08 |
| 2.7 | Cookie `SameSite` set | ✅ Verified | `Lax` (`session.js` 14) | — |
| 2.8 | `__Host-` cookie prefix | ⛔ Not implemented | Name is `musabe_sid` | S-08 |
| 2.9 | Absolute session timeout | ✅ Verified | 12 h / 30 days (`session.js` 9–10) | — |
| 2.10 | Idle timeout | ⛔ Not implemented | `last_seen_at` stored but not used | S-17 |
| 2.11 | Sessions ended on password reset / switch-off, including live screens | ✅ Verified | `endAllSessions` (`session.js` 40–44); `checkSessions` (`realtime.js` 41–49) | — |
| 2.12 | User can see and end own sessions | ✅ Verified | `me.js` 93–126 | — |
| 2.13 | Expired sessions removed | ⛔ Not implemented | | S-17 |

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
| 3.8 | Minimum data exposure on school list | ❌ Failed | Staff counts and School Admin names to all roles (`schools.js` 17–25) | S-15 |
| 3.9 | Cannot remove last Super Admin | ✅ Verified | `users.js` 145–148 | — |
| 3.10 | Users cannot change own role, name, school | ✅ Verified | `me.js` 13, 42–48 | — |
| 3.11 | Automated authorization matrix test (all roles × routes × schools) | ⛔ Not implemented | No tests | Q-01 |
| 3.12 | Separation of duties for finance actions | ⛔ Not implemented | Finance not built | §8 |
| 3.13 | Database-level isolation (RLS) for sensitive tables | ⛔ Not implemented | Planned for student/finance tables | D-07 |

## 4. Input validation and injection

| # | Requirement | Status | Evidence / note | Finding |
|---|---|---|---|---|
| 4.1 | SQL queries parameterized | ✅ Verified | All `whereRaw`/`raw` use bindings | — |
| 4.2 | Schema validation on every endpoint | ❌ Failed | Hand-written checks; some `NaN` reach SQL (`users.js` 50) | A-03 |
| 4.3 | Output encoding against XSS | ✅ Verified | React escaping; no `dangerouslySetInnerHTML` in `frontend/src` | — |
| 4.4 | Request body size limits | ✅ Verified | JSON 1 MB (`server.js` 11); upload 5 MB (`items.js` 226) | — |
| 4.5 | Upload content type restricted | ❌ Failed | `express.raw({ type: () => true })` (`items.js` 226) | S-06 |
| 4.6 | Upload decompressed size / resource limits | ⛔ Not implemented | Workbook fully loaded first (`excel.js` 55) | S-10 |
| 4.7 | Upload row limit | ✅ Verified (exists) / ❌ Failed (late) | Checked after full parse (`items.js` 229) | S-10 |
| 4.8 | Upload frequency limit | ⛔ Not implemented | | S-10 |
| 4.9 | Spreadsheet formula injection in exports | ✅ Verified (not exploitable in .xlsx today) | Tested: ExcelJS writes `=...` as string cell | S-18 |
| 4.10 | Formula guard for future CSV/formula exports | ⛔ Not implemented | | S-18 |
| 4.11 | Hostile Excel file tests (malformed, zip bomb, huge sheet) | 🔍 Requires runtime verification | | S-10 |

## 5. CSRF and browser security

| # | Requirement | Status | Evidence / note | Finding |
|---|---|---|---|---|
| 5.1 | No state change on GET | ✅ Verified | All changes are POST/PATCH/PUT | — |
| 5.2 | CSRF token or Origin/Referer validation | ⛔ Not implemented | Relies on SameSite=Lax only | S-06 |
| 5.3 | CORS not open | ✅ Verified | No CORS middleware (same-origin only) | — |
| 5.4 | Content-Security-Policy | ⛔ Not implemented | | S-07 |
| 5.5 | HSTS | ⛔ Not implemented | | S-07 |
| 5.6 | `X-Content-Type-Options: nosniff` | ✅ Verified | `server.js` 14 (API only) | — |
| 5.7 | Clickjacking protection | ✅ Verified (API) / 🔍 (HTML page) | `X-Frame-Options: DENY` set by Express; HTML is served by Vite/Nginx | S-07 |
| 5.8 | `Referrer-Policy` | ✅ Verified (API) | `same-origin` | — |
| 5.9 | `Permissions-Policy`, COOP | ⛔ Not implemented | | S-07 |
| 5.10 | `X-Powered-By` removed | ✅ Verified | `server.js` 10 | — |

## 6. Transport security

| # | Requirement | Status | Evidence / note | Finding |
|---|---|---|---|---|
| 6.1 | HTTPS only, HTTP redirected | 🔍 Requires runtime verification | No code or deployment config in repo | S-08 |
| 6.2 | TLS 1.2+ with modern ciphers | 🔍 Requires runtime verification | Proxy config not in repo | — |
| 6.3 | Trusted proxy configured exactly | ❌ Failed | `trust proxy = 1` fixed; spoofing proven in test | S-02 |
| 6.4 | Node not reachable directly from the internet | 🔍 Requires runtime verification | | S-02 |
| 6.5 | Database connection encrypted (if remote) | ⛔ Not implemented | No `ssl` option in `knexfile.js` | S-03 |

## 7. Error handling, logging and audit

| # | Requirement | Status | Evidence / note | Finding |
|---|---|---|---|---|
| 7.1 | Generic errors to users for unexpected failures | ✅ Verified | `server.js` 44–45 | — |
| 7.2 | No internal details on public endpoints | ❌ Failed | `/api/health` returns `e.message` | S-09 |
| 7.3 | Business actions written to audit log in same transaction | ✅ Verified | `audit(..., trx)` across routes | — |
| 7.4 | Audit log append-only at database level | ❌ Failed | App DB user can update/delete | S-12 |
| 7.5 | Price history cannot be deleted | ❌ Failed | `ON DELETE CASCADE` (`004` 45) | S-12 |
| 7.6 | Failed logins logged | ❌ Failed | Only lockouts logged | S-14 |
| 7.7 | Authorization failures logged | ⛔ Not implemented | | S-14 |
| 7.8 | Structured logs with request id and secret redaction | ⛔ Not implemented | `console.error` only | A-11 |
| 7.9 | Security alerting | ⛔ Not implemented | | A-11 |
| 7.10 | Error monitoring service | ⛔ Not implemented | | Q |

## 8. API abuse and denial of service

| # | Requirement | Status | Evidence / note | Finding |
|---|---|---|---|---|
| 8.1 | Rate limit on login and forgot | ✅ Verified (exists) / ❌ Failed (bypassable) | `auth.js` 11; IP spoofable | S-02 |
| 8.2 | General API rate limit | ⛔ Not implemented | | — |
| 8.3 | Limits on list sizes | ✅ Verified (partly) | Audit max 1000 / export 20000; users and items unpaginated (small today) | — |
| 8.4 | Real-time connection limits | ⛔ Not implemented | `realtime.js` 81–94 | S-11 |
| 8.5 | Load test of login and SSE | 🔍 Requires runtime verification | | — |

## 9. Secrets and configuration

| # | Requirement | Status | Evidence / note | Finding |
|---|---|---|---|---|
| 9.1 | `.env` not committed (now or in history) | ✅ Verified | `.gitignore`; git history search found no `.env` | — |
| 9.2 | No secrets in source or docs | ❌ Failed | Default admin password published | S-01 |
| 9.3 | Configuration validated at start; unsafe production values refused | ⛔ Not implemented | Silent fallbacks in `knexfile.js`, seed, session | A-06 |
| 9.4 | Secret scanning in CI | ⛔ Not implemented | No CI | Q |
| 9.5 | Rotation of credentials used during development | 🔍 Requires runtime verification | Local `.env` holds the default admin password; confirm it was changed on every DB where the seed ran | S-01 |

## 10. Database security and integrity

| # | Requirement | Status | Evidence / note | Finding |
|---|---|---|---|---|
| 10.1 | App uses a least-privilege DB role | ❌ Failed | Defaults to `postgres` | S-03 |
| 10.2 | Separate migration role and runtime role | ⛔ Not implemented | | S-03 |
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
| 12.1 | Backend automated tests | ⛔ Not implemented | No test script or folder |
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
