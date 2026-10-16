# Database Backup and Restore

The Musabe system stores all data in PostgreSQL. Two helper scripts automate
backup and restore and work whether PostgreSQL runs under Docker Compose or as
a native service.

- `scripts/backup_database.sh` — writes a timestamped, gzipped SQL dump.
- `scripts/restore_database.sh` — restores a dump (destructive).

Both scripts read `POSTGRES_*` values from `.env`, never print the password,
and auto-detect a running Docker Compose database (falling back to a local
`pg_dump`/`psql` client).

---

## Backups

Run from the project root:

```bash
scripts/backup_database.sh
```

- Output: `backups/musabe_YYYY-MM-DD_HHMMSS.sql.gz`
- The script **refuses to overwrite** an existing file.
- Override the location with `BACKUP_DIR=/mnt/backups scripts/backup_database.sh`.

`backups/` and `*.sql*.gz` are excluded from Git.

### Verify a backup

```bash
gunzip -c backups/musabe_2026-01-01_120000.sql.gz | head -n 20
```

You should see SQL `CREATE TABLE` / `COPY` statements. The first line of a
`pg_dump` file also records the PostgreSQL version used.

---

## Restore

**Restoring overwrites the current database.** Always take a fresh backup first.

```bash
scripts/backup_database.sh                 # safety backup of current data
scripts/restore_database.sh backups/musabe_2026-01-01_120000.sql.gz
```

The script asks you to type `YES` before doing anything, then replays the dump
with `--clean` semantics (objects are dropped and recreated).

### Test a restore without touching production

Restore into a throwaway database to confirm a backup is valid:

```bash
# Native example
createdb musabe_test
gunzip -c backups/musabe_2026-01-01_120000.sql.gz \
  | psql -h localhost -U musabe -d musabe_test -v ON_ERROR_STOP=1
psql -h localhost -U musabe -d musabe_test -c "SELECT count(*) FROM users;"
dropdb musabe_test
```

Never run destructive restore tests against a production database.

---

## Moving data to another Ubuntu computer

1. On the source machine, create a backup (above).
2. Copy the file:

   ```bash
   scp backups/musabe_2026-01-01_120000.sql.gz user@new-host:/tmp/
   ```

3. On the new machine, install the system (see
   [`INSTALLATION.md`](INSTALLATION.md)), start the database, then restore:

   ```bash
   scripts/restore_database.sh /tmp/musabe_2026-01-01_120000.sql.gz
   ```

---

## Scheduling automatic backups

Add a cron entry (adjust paths):

```cron
0 2 * * * cd /opt/musabe-backend && BACKUP_DIR=/mnt/backups scripts/backup_database.sh >> /var/log/musabe-backup.log 2>&1
```

Retain off-machine copies by syncing `BACKUP_DIR` to remote storage.

---

## Direct Docker commands (manual alternative)

```bash
# Backup
docker compose exec -T db pg_dump -U musabe -d musabe --clean --if-exists \
  | gzip > backups/manual_$(date +%F_%H%M%S).sql.gz

# Restore
gunzip -c backups/manual_2026-01-01_120000.sql.gz \
  | docker compose exec -T db psql -U musabe -d musabe -v ON_ERROR_STOP=1
```
