# Musabe Schools Management System

Version 1.0 foundation for Musabe Schools (Buhongwa, Mwanza).

One system for staff registration, buying workflows, library and store control across Central Administration and three schools:

- Nursery & Primary
- Girls Secondary
- Boys Secondary

**Authoritative documents**

- `docs/roadmap.md` — what to build and in what order
- `docs/progress.md` — current status
- `CLAUDE.md` — how to work (one step at a time)

The original proposal is the source of truth for roles, approval chains and flows.

## Structure (planned)

```
Musabe/
├── docs/           # Roadmap, progress, design notes
├── node/           # API (Express 5, Knex, PostgreSQL, Redis) — not yet created
├── web/            # React 19 + TypeScript + Vite — not yet created
├── CLAUDE.md
└── README.md
```

## Current focus

Documentation only. Implementation of `node/` and `web/` comes after the docs are approved.
