# Deployment notes (VPS)

Short checklist for putting the system on the real server. Local setup: `running-locally.md`.

## 1. Backend `.env` (production)
- `NODE_ENV=production`
- `APP_ORIGIN=https://<your address>` (required: the server will not start without it)
- `TRUST_PROXY=127.0.0.1` (Nginx on the same machine)
- `DATABASE_USER=musabe_app`, `MIGRATION_DATABASE_USER=musabe_owner` (see `database-roles.md`)
- `DATABASE_SSL=true` if the database is on another machine
- Remove `SUPERADMIN_PASSWORD` after the first sign-in

## 2. After every update
```
cd backend && npm ci && npm run migrate
psql -U postgres -d musabe_db -v ON_ERROR_STOP=1 -f db/provision-roles.sql
npm test   # only against a TEST database (TEST_DATABASE_URL)
cd ../frontend && npm ci && npm run build
```

## 3. Nginx (page headers)
The API sets its own security headers. The page (`frontend/dist`) needs these in the Nginx `server` block:
```
add_header Content-Security-Policy "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'" always;
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
add_header X-Content-Type-Options nosniff always;
add_header Referrer-Policy same-origin always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;   # scanning is done with QR scanners (and later the mobile app), not the page camera

location /api/ {
  proxy_pass http://127.0.0.1:4310;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_buffering off;          # live updates (/api/events)
  proxy_read_timeout 1h;
  client_max_body_size 6m;      # Excel uploads (5 MB)
}
location / { root /var/www/musabe/dist; try_files $uri /index.html; }
```

## 4. Still to do before real data
- Daily encrypted database backup kept off the server, and one test restore.
- Error monitoring / log rotation (PM2 or systemd journal).
