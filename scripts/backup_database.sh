#!/usr/bin/env bash
#
# Back up the Musabe PostgreSQL database to a timestamped, gzipped SQL dump.
#
# Usage:
#   scripts/backup_database.sh
#   BACKUP_DIR=/mnt/backups scripts/backup_database.sh
#
# The script never prints the database password and never overwrites an
# existing backup file. It works either against the Docker Compose database
# or a locally installed PostgreSQL client.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${ENV_FILE:-${ROOT_DIR}/.env}"
BACKUP_DIR="${BACKUP_DIR:-${ROOT_DIR}/backups}"

# ── Read configuration from .env without executing it ──────────────────────
read_env() {
    local key="$1" default="${2:-}"
    if [[ -f "${ENV_FILE}" ]]; then
        local value
        value="$(sed -n "s/^[[:space:]]*${key}[[:space:]]*=[[:space:]]*//p" "${ENV_FILE}" | head -n1)"
        if [[ -n "${value}" ]]; then
            echo "${value}"
            return
        fi
    fi
    echo "${default}"
}

PGUSER="$(read_env POSTGRES_USER musabe)"
PGPASSWORD="$(read_env POSTGRES_PASSWORD musabe)"
PGDATABASE="$(read_env POSTGRES_DB musabe)"
PGHOST="$(read_env POSTGRES_HOST localhost)"
PGPORT="$(read_env POSTGRES_PORT 5432)"

# ── Checks ─────────────────────────────────────────────────────────────────
if ! command -v gzip >/dev/null 2>&1; then
    echo "ERROR: 'gzip' is required but was not found in PATH." >&2
    exit 1
fi

mkdir -p "${BACKUP_DIR}"
TIMESTAMP="$(date +%Y-%m-%d_%H%M%S)"
OUT_FILE="${BACKUP_DIR}/musabe_${TIMESTAMP}.sql.gz"

if [[ -e "${OUT_FILE}" ]]; then
    echo "ERROR: ${OUT_FILE} already exists; refusing to overwrite." >&2
    exit 1
fi

use_docker=0
if command -v docker >/dev/null 2>&1 \
    && docker compose version >/dev/null 2>&1 \
    && [[ -n "$(cd "${ROOT_DIR}" && docker compose ps -q db 2>/dev/null)" ]]; then
    use_docker=1
fi

echo "Backing up database '${PGDATABASE}' ..."

if [[ "${use_docker}" -eq 1 ]]; then
    (cd "${ROOT_DIR}" && docker compose exec -T db \
        pg_dump -U "${PGUSER}" -d "${PGDATABASE}" --clean --if-exists) | gzip > "${OUT_FILE}"
else
    if ! command -v pg_dump >/dev/null 2>&1; then
        echo "ERROR: neither the Docker database nor the 'pg_dump' client is available." >&2
        exit 1
    fi
    PGPASSWORD="${PGPASSWORD}" pg_dump -h "${PGHOST}" -p "${PGPORT}" \
        -U "${PGUSER}" -d "${PGDATABASE}" --clean --if-exists | gzip > "${OUT_FILE}"
fi

echo "Backup written to: ${OUT_FILE}"
echo "Size: $(du -h "${OUT_FILE}" | cut -f1)"
