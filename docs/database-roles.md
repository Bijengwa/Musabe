# Database accounts and safe deployment (Phase 1)

The running app must **not** connect to PostgreSQL as `postgres` (a superuser). A superuser can read every
database on the server, drop tables, and even run operating-system commands. If the app is ever tricked
(for example by a future bug), that power goes to the attacker.

So Musabe uses **two** accounts:

| Account | Used by | Can do | Cannot do |
|---|---|---|---|
| `musabe_owner` | `npm run migrate`, `npm run seed`, `npm run setup` only | Owns the Musabe tables: create and change them | Superuser, create databases, create roles |
| `musabe_app` | The running API (`npm start`, `npm run dev`) | Read and write rows it needs, table by table | Create, change or drop tables; change or delete audit history and price history; read migration records |

What `musabe_app` may do (from `backend/db/provision-roles.sql`, checked against the code):

| Table | Rights |
|---|---|
| `schools`, `users`, `items` | read, add, change |
| `sessions`, `item_prices` | read, add, change, delete |
| `audit_log`, `item_price_changes` | read and add only (history cannot be changed or deleted) |
| `knex_migrations`, `knex_migrations_lock` | none |

The app also checks this itself at start-up (`backend/src/db-role.js`):

- `NODE_ENV=production`: the app **does not start** if its account is a superuser, can create roles or databases,
  bypasses row security, owns the database, or owns any table. It also does not start if it cannot check
  (database unreachable); your process manager (PM2, systemd) will retry.
- Any other `NODE_ENV`: a clear warning only, so local development keeps working.

## Files

| File | What it does |
|---|---|
| `backend/db/provision-roles.sql` | Creates the two roles if missing, makes `musabe_owner` owner of the Musabe tables, sets the app's rights. Safe to run again. Changes **no rows**, sets **no passwords**, drops nothing. |
| `backend/db/check-roles.sql` | Read-only report: role powers and the app's rights on every table. |
| `backend/knexfile.js` | Migrations use `MIGRATION_DATABASE_*` (owner). The app (`src/db.js`) uses `DATABASE_*` (restricted). |

## Production deployment steps (controlled, in a quiet moment)

Do these on the server, with a backup first. Nothing here deletes data, but ownership changes take a short lock on
each table.

1. **Back up** the database: `pg_dump -Fc -U postgres -d musabe_db -f musabe_before_roles.dump`
   and keep the file somewhere safe (not in Git).
2. **Create the roles and set rights** (as the PostgreSQL superuser):
   ```
   psql -U postgres -d musabe_db -v ON_ERROR_STOP=1 -f backend/db/provision-roles.sql
   ```
3. **Set strong, different passwords** (psql asks for them and does not show them or keep them in history):
   ```
   psql -U postgres -d musabe_db
   \password musabe_owner
   \password musabe_app
   \q
   ```
   Keep them in your password manager. Never in Git, never in documents or chat.
4. **Check**: `psql -U postgres -d musabe_db -f backend/db/check-roles.sql`
   Both roles must show `false` for every power, all tables owned by `musabe_owner`, and the rights listed above.
5. **Edit `backend/.env` on the server** (not in Git):
   ```
   DATABASE_USER=musabe_app
   DATABASE_PASSWORD=<the musabe_app password>
   MIGRATION_DATABASE_USER=musabe_owner
   MIGRATION_DATABASE_PASSWORD=<the musabe_owner password>
   NODE_ENV=production
   TRUST_PROXY=            # empty = Nginx on this same server. Nginx elsewhere: its IP address.
   ```
   If PostgreSQL is on another machine, also allow these two users in its `pg_hba.conf` (with `scram-sha-256`).
6. **Restart the app.** The log must show `Musabe API running` and must not show a warning about the database account.
   `GET /api/health` must answer `{ "ok": true, ... }`.
7. Sign in, open Staff, Items and Activity, and make one harmless change (e.g. your theme) to confirm writing works.

**Rollback** (if step 6 fails): first read the error in the log; it names the problem (usually a wrong password or
`pg_hba.conf`). If you must go back, deploy the **previous release** of the code with the old `.env`, or restore the
step 1 backup. Do **not** change `NODE_ENV` away from `production` to get around the check: it also turns off the
`Secure` flag on the sign-in cookie. The roles and grants can stay; they do not affect the old setup.

### Every later deployment that has new migrations

```
npm run migrate                                                             # runs as musabe_owner
psql -U postgres -d musabe_db -v ON_ERROR_STOP=1 -f backend/db/provision-roles.sql   # apply the rights list to new tables
```

New tables made by `musabe_owner` automatically get normal read/write rights for `musabe_app`. If a new table must
be **add-only** (like `audit_log`) or the app must not touch it, add it to the list in `provision-roles.sql`
in the same change as its migration. The script warns about any table that is not in its list.

## Local development

Two choices:

- **Same as production (recommended):** create a local `musabe_db`, run steps 2, 3 and 5 above on your machine
  (with `NODE_ENV=development`). Then `npm run setup` and `npm run dev`.
- **Quick, single account:** leave `DATABASE_USER` as `postgres` (or empty) and the `MIGRATION_*` values empty.
  Everything works as before, but the app prints a warning at start. Never do this in production.

## Nginx and the client IP

Nginx must pass the real client address. Either line works with the default `TRUST_PROXY` (loopback):

```
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;   # or: $remote_addr;
proxy_set_header X-Forwarded-Proto $scheme;
```

Make Node listen only where Nginx can reach it (not on the public internet), and keep the firewall closed on the API
port. Only the address that the trusted proxy adds is believed; anything a client writes in `X-Forwarded-For` before
that is ignored. This is tested in `backend/test/proxy-ip*.test.js`.

## Tests

```
cd backend
npm test                                    # proxy/IP tests (no database needed)
TEST_DATABASE_URL=postgres://musabe_app:<pw>@localhost:5432/musabe_test npm test   # also database tests
```

Use a separate **test** database for `TEST_DATABASE_URL`, already migrated and provisioned. The database tests add a
test account and sessions; never point them at real data.
