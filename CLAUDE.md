# Musabe Development Rules

Musabe Schools Management System — Central Administration + three schools.

- `docs/roadmap.md` is the authoritative roadmap.
- `docs/progress.md` tracks status.
- Build **exactly one roadmap step at a time**.

## Before any implementation

1. Read the step in `docs/roadmap.md` and the current state in `docs/progress.md`.
2. Inspect any existing code it touches.
3. Explain what will change and which files.
4. Confirm the work stays inside that step’s Scope and outside its “Not in this step”.

## After implementation

1. Run the relevant checks.
2. Review the resulting diff.
3. Tick only that step in `docs/progress.md` and update “Current step” only if its “Done when” checks pass.
4. Report exactly what changed and what was verified.
5. Stop. Never continue to the next step automatically.

## Authentication principles (from PSP pattern + proposal)

- Opaque session ID in an HttpOnly cookie.
- Redis-backed sessions; PostgreSQL is authoritative for identity, status and roles.
- Frontend learns who is logged in only from `GET /api/auth/me`.
- No auth tokens or staff profiles in localStorage / sessionStorage.
- Redis failure fails closed for management authentication.
- Password reset / temporary passwords force change on next login.
- Never log passwords, hashes or session IDs.
- Role-based access: each person sees and does only what their role allows.

## UI principles

- Clean, professional, compact, accessible, responsive (360 px / 768 px / desktop).
- Light and dark themes.
- No emoji icons.
- No dashboard cards or statistics without real data behind them.
- Role-based sidebar: only show items the current role can use.

## Files

The user decides file and folder placement. Propose new paths and ask before creating them.

## Scope discipline

Do not implement more than one roadmap step at once.
Do not modify unrelated features.
Prefer small, reviewable changes.
