#!/usr/bin/env bash
#
# Container entrypoint: wait for PostgreSQL, apply migrations, start the API.
# Seeding is intentionally NOT automatic (see docs/INSTALLATION.md) so that
# sample data is never written into a production database by accident.
set -euo pipefail

cd /app

echo "[entrypoint] Waiting for the database to accept connections..."
python - <<'PY'
import sys
import time

from sqlalchemy import create_engine, text

from app.core.config import settings

attempts = 40
for attempt in range(1, attempts + 1):
    try:
        engine = create_engine(settings.database_url, pool_pre_ping=True)
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        print("[entrypoint] Database is ready.")
        sys.exit(0)
    except Exception as exc:  # noqa: BLE001 - retry loop
        print(f"[entrypoint]   not ready ({attempt}/{attempts}): {exc}")
        time.sleep(2)

print("[entrypoint] Database did not become ready in time.", file=sys.stderr)
sys.exit(1)
PY

echo "[entrypoint] Applying database migrations..."
python -m alembic upgrade head

echo "[entrypoint] Starting the web server on port 8000..."
exec python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
