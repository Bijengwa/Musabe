# Running Musabe locally

## Ports (reserved for Musabe)

| Part | Port | Where it is set |
|---|---|---|
| Backend API (Express) | **4310** | `backend/.env` (`PORT=4310`). Without it, `npm run dev`/`npm start` (`src/server.js`) use **3001** and `node server.js` uses 4310, so keep `PORT=4310` in `.env`. |
| Frontend (Vite) | **5190** | `frontend/vite.config.js` (`server.port`, `strictPort: true`) |

The frontend proxies every `/api` call to the backend (`http://localhost:4310`), so the browser only
ever talks to **http://localhost:5190**.

These ports were chosen because other projects on this machine use the common ones
(NiJibu admin on 5173, Expo on 8081/8082, and others). `strictPort` makes Vite fail with a clear
message if 5190 is taken, instead of silently moving to another port.

If a port is ever taken, pick another free one and change it in **both** places (the backend port in
`backend/.env` and the proxy target in `frontend/vite.config.js`).

## Database accounts

The app should use the restricted `musabe_app` account and migrations the `musabe_owner` account.
See [database-roles.md](database-roles.md). If you still use `postgres` locally, the app works but prints a warning.
In production it refuses to start as `postgres`.

## Start

Two terminals:

```
cd backend  && npm run dev     # API on http://localhost:4310  (auto-restarts on file changes)
cd frontend && npm run dev     # App on http://localhost:5190
```

Check: http://localhost:4310/api/health must show `"database": "connected"`. Then open
**http://localhost:5190** and sign in.

Use `npm run dev` for the backend, not `npm start`: `start` does not reload, so new routes return 404
until you restart.

## Stop

Press `Ctrl+C` in each terminal. Start only **one** copy of each. Two copies fight over the port and one
dies, and the frontend then shows 502 or "Cannot reach the server".

## Problems we hit, and the cause

| Symptom | Cause | Fix |
|---|---|---|
| Profile page says "not found" (404 from `/api/me/profile`) | Backend was started before `routes/me.js` existed and was not reloaded | Restart the backend; use `npm run dev` |
| Frontend shows 502 | Backend not running (crashed because two `--watch` copies shared one port) | Run exactly one backend |
| Login says "Cannot reach the server. Check that the backend is running." | Browser tab still open on an old frontend address (5173/5174/5180) whose Vite server no longer exists | Close the tab and open http://localhost:5190 |
| `localhost:5173` gives 502 or odd JSON errors | 5173 belongs to another project (NiJibu admin), not Musabe | Always use 5190 for Musabe |

## Checking what is on a port (Windows)

```
curl -s -o NUL -w "%{http_code}" http://localhost:5190/
Get-NetTCPConnection -LocalPort 4310 -State Listen | Select OwningProcess
Get-CimInstance Win32_Process -Filter "ProcessId=<pid>" | Select CommandLine
```

`netstat` in Git Bash is unreliable here; prefer the PowerShell commands above.
