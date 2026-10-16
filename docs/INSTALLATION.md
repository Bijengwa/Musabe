# Installation Guide

This guide installs the Musabe Schools Management System on a fresh Ubuntu
machine. Two supported paths are covered:

1. **Docker Compose (recommended)** — runs PostgreSQL and the web application
   in containers. This is the most portable and reproducible option.
2. **Native installation** — Python virtual environment + a system PostgreSQL
   server. Useful if Docker is not available.

The public website, the JSON API, and the interactive `docs` page are all
served by the same backend on port **8000**.

---

## 1. Requirements

| Path | Minimum |
| ---- | ------- |
| Docker Compose | Ubuntu 22.04+, Docker Engine 24+, Compose v2 |
| Native | Ubuntu 22.04+, Python 3.11+, PostgreSQL 14+ |

---

## 2. Docker Compose (recommended)

### 2.1 Install Docker (once per machine)

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl git
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker "$USER"   # log out and back in for this to apply
```

### 2.2 Get the code and configure secrets

```bash
git clone https://github.com/<your-username>/musabe-backend.git
cd musabe-backend

cp .env.example .env
```

Edit `.env` and set at least:

- `POSTGRES_PASSWORD` — a strong database password.
- `JWT_SECRET_KEY` — a long random string. Generate one with:

  ```bash
  python3 -c "import secrets; print(secrets.token_urlsafe(48))"
  ```

Never commit the `.env` file. It is already listed in `.gitignore`.

### 2.3 Build and start

```bash
docker compose up --build -d
```

This starts two services:

- `db` — PostgreSQL 16, data persisted in the `pgdata` volume.
- `backend` — the API and website; waits for the database, applies migrations,
  then serves on port 8000.

### 2.4 Load demo data (optional)

```bash
docker compose run --rm backend python -m scripts.seed
```

### 2.5 Access

- Website: <http://localhost:8000/>
- API docs: <http://localhost:8000/docs>
- Health: <http://localhost:8000/health>

### 2.6 Day-to-day commands

```bash
docker compose ps                 # service status + health
docker compose logs -f backend    # follow application logs
docker compose restart backend    # restart the web app (keeps data)
docker compose down               # stop (KEEPS the database volume)
docker compose down -v            # stop and DELETE all data (destructive)
docker compose up --build -d      # rebuild after a code change
```

### 2.7 Applying migrations

Migrations run automatically on every container start. To run them manually:

```bash
docker compose run --rm backend python -m alembic upgrade head
```

---

## 3. Native installation (without Docker)

### 3.1 System packages

```bash
sudo apt-get update
sudo apt-get install -y python3 python3-venv python3-pip postgresql postgresql-contrib
```

### 3.2 Create the database

```bash
sudo -u postgres psql <<'SQL'
CREATE USER musabe WITH PASSWORD 'change-me';
CREATE DATABASE musabe OWNER musabe;
SQL
```

### 3.3 Python environment

```bash
cd musabe-backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### 3.4 Configure `.env`

```bash
cp .env.example .env
```

Set `POSTGRES_*`, `JWT_SECRET_KEY`, and (for a non-local host) `POSTGRES_HOST`.

### 3.5 Migrate, seed, and run

```bash
python -m alembic upgrade head
python -m scripts.seed              # optional demo data
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

### 3.6 Optional: run as a systemd service

Create `/etc/systemd/system/musabe.service`:

```ini
[Unit]
Description=Musabe Schools Management System
After=network.target postgresql.service

[Service]
WorkingDirectory=/opt/musabe-backend
EnvironmentFile=/opt/musabe-backend/.env
ExecStart=/opt/musabe-backend/.venv/bin/python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
Restart=on-failure
User=www-data

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now musabe
sudo systemctl status musabe
```

---

## 4. Running the tests

Tests use an isolated in-memory SQLite database and do not touch PostgreSQL or
any local data:

```bash
python -m pytest -q
```

---

## 5. Troubleshooting

| Symptom | Likely cause / fix |
| ------- | ------------------ |
| `backend` restarts in a loop | Database not reachable. Check `docker compose logs db` and your `POSTGRES_*` values. |
| `set JWT_SECRET_KEY in .env` | The `.env` file is missing `JWT_SECRET_KEY`. Set it and re-run. |
| Port 8000 already in use | Stop the other process or change the `backend` port mapping in `compose.yaml`. |
| Login works but data is empty | Run the seed step (2.4). |
| Browser shows a stale page | Hard-refresh (Ctrl+Shift+R). |

---

## 6. Security notes for production

- Use a long, random `JWT_SECRET_KEY`.
- Use a strong `POSTGRES_PASSWORD`; do not expose the database port publicly.
- Restrict `CORS_ORIGINS` to your real domain instead of `*`.
- Terminate TLS with a reverse proxy (nginx/Caddy) in front of port 8000.
- Back up the database regularly — see
  [`DATABASE_BACKUP.md`](DATABASE_BACKUP.md).
