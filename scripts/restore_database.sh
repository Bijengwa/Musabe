#!/usr/bin/env bash
#
# Restore the Musabe PostgreSQL database from a backup produced by
# scripts/backup_database.sh.
#
# Usage:
#   scripts/restore_database.sh backups/musabe_2026-01-01_120000.sql.gz
#
# This operation is DESTRUCTIVE: it runs the dump with --clean and will drop
# and recreate database objects. You must type YES to proceed. Always take a
# fresh backup of the current database first.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${ENV_FILE:-${ROOT_DIR}/.env}"

if [[ $# -ne 1 ]]; then
    echo "Usage: $0 <backup-file.sql|backup-file.sql.gz>" >&2
    exit 2
fi

BACKUP_FILE="$1"
if [[ ! -f "${BACKUP_FILE}" ]]; then
    echo "ERROR: backup file not found: ${BACKUP_FILE}" >&2
    exit 1
fi

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

echo "WARNING: This will OVERWRITE the contents of database '${PGDATABASE}'."
echo "Backup file: ${BACKUP_FILE}"
read -r -p "Type YES to continue: " reply
if [[ "${reply}" != "YES" ]]; then
    echo "Aborted."
    exit 1
fi

use_docker=0
if command -v docker >/dev/null 2>&1 \
    && docker compose version >/dev/null 2>&1 \
    && [[ -n "$(cd "${ROOT_DIR}" && docker compose ps -q db 2>/dev/null)" ]]; then
    use_docker=1
fi

echo "Restoring..."

if [[ "${use_docker}" -eq 1 ]]; then
    gunzip -c "${BACKUP_FILE}" | (cd "${ROOT_DIR}" && docker compose exec -T db \
        psql -U "${PGUSER}" -d "${PGDATABASE}" -v ON_ERROR_STOP=1)
else
    if ! command -v psql >/dev/null 2>&1; then
        echo "ERROR: neither the Docker database nor the 'psql' client is available." >&2
        exit 1
    fi
    gunzip -c "${BACKUP_FILE}" | PGPASSWORD="${PGPASSWORD}" psql -h "${PGHOST}" \
        -p "${PGPORT}" -U "${PGUSER}" -d "${PGDATABASE}" -v ON_ERROR_STOP=1
fi

echo "Restore complete."
