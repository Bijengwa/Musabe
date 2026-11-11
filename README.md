# Musabe Schools System

One system for Musabe English Medium School, Musabe Boys Secondary School and Musabe Girls Secondary School.

- `backend/` — Node.js + Express 5 + Knex + PostgreSQL (API on port 4310)
- `frontend/` — React 19 + Vite (opens on port 5190, sends `/api` to the backend)
- `docs/roadmap.md` — the plan · `docs/progress.md` — where we are
- `musabe_schools_system.html` — clickable prototype of the full system

## First-time setup (Windows)

1. **Create the database** (PostgreSQL must be running). In pgAdmin or `psql`:
   ```sql
   CREATE DATABASE musabe_db;
   ```
2. **Backend**
   ```powershell
   cd backend
   copy .env.example .env      # then open .env and put your PostgreSQL password in DATABASE_PASSWORD
   npm install
   npm run setup               # creates the tables and the first Super Admin
   npm run dev
   ```
   Check http://localhost:4310/api/health shows `"database": "connected"`.
3. **Frontend** (second terminal)
   ```powershell
   cd frontend
   npm install
   npm run dev
   ```
   Open http://localhost:5190

## First sign-in
- Username: `superadmin`
- Password: `Musabe@2026` (or what you set in `SUPERADMIN_PASSWORD` before `npm run setup`)
- You must choose your own password straight away.

Then: **Staff accounts → New account** → create a School Admin for each school. The screen shows a temporary password once; give it to the person. They sign in, choose their own password, and create the staff of their school.

## Useful commands (backend)
| Command | What it does |
|---|---|
| `npm run dev` | Start the API and restart on file changes |
| `npm run migrate` | Apply new database changes |
| `npm run rollback` | Undo the last database change |
| `npm run seed` | Add the 3 schools and the Super Admin if missing (safe to run again) |

## Where things are
| What | File |
|---|---|
| Roles and who sees which page | `backend/src/auth/roles.js` |
| Sign-in, sessions, page checks | `backend/src/auth/session.js` |
| Staff accounts API | `backend/src/routes/users.js` |
| Database tables | `backend/migrations/` |
| Sidebar items | `frontend/src/nav.js` |
| Sidebar + hamburger | `frontend/src/layout/Shell.jsx` |
| Staff accounts screen | `frontend/src/pages/Staff.jsx` |
