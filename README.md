# Helpdesk

AI-powered ticket management system. See [`project-scope.md`](./project-scope.md), [`tech-stack.md`](./tech-stack.md), and [`implementation-plan.md`](./implementation-plan.md).

## Layout

```
backend/             Express + TypeScript, run on Bun
frontend/            React + TypeScript + React Router, built with Vite (run on Bun)
docker-compose.yml   Local PostgreSQL for development
```

## Prerequisites

- [Bun](https://bun.com) (v1.1+). On Windows in PowerShell:
  ```powershell
  powershell -c "irm bun.sh/install.ps1 | iex"
  ```
  Restart your terminal, then `bun --version` to verify.
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) for the local Postgres container.

## First-time setup

From the repo root:

```powershell
# 1. Start Postgres (creates the `helpdesk` database)
docker compose up -d

# 2. Install backend deps, set up env, generate Prisma client, run first migration
cd backend
bun install
Copy-Item .env.example .env  # adjust DATABASE_URL if needed
bun run db:migrate           # creates the migration and applies it

# 3. Install frontend deps
cd ..\frontend
bun install
```

The backend `.env` defaults to `postgresql://postgres:postgres@localhost:5432/helpdesk?schema=public`, which matches `docker-compose.yml`.

## Running locally

Open two terminals.

**Terminal 1 — backend** (http://localhost:3001):

```powershell
cd backend
bun run dev
```

**Terminal 2 — frontend** (http://localhost:5173):

```powershell
cd frontend
bun run dev
```

The Vite dev server proxies `/api/*` to the backend.

Verify everything is wired up:

- `http://localhost:3001/api/health` — backend up
- `http://localhost:3001/api/db-check` — should return `{ "status": "ok", "userCount": 0 }` once migrations have run

## Scripts

Backend (`backend/`):

- `bun run dev` — start with hot reload
- `bun run start` — start once, no watcher
- `bun run typecheck` — type-check without emitting
- `bun run db:migrate` — create a new migration from schema changes and apply it (dev)
- `bun run db:generate` — regenerate the Prisma client (run after schema changes if not using `db:migrate`)
- `bun run db:deploy` — apply existing migrations without prompting (use in CI / prod)
- `bun run db:studio` — open Prisma Studio at http://localhost:5555
- `bun run db:reset` — drop the database and re-apply all migrations (destructive)

Frontend (`frontend/`):

- `bun run dev` — Vite dev server with HMR
- `bun run build` — type-check and build for production
- `bun run preview` — preview the production build
- `bun run typecheck` — type-check only

## Database

PostgreSQL runs in Docker via `docker-compose.yml`. The database is named `helpdesk` and the data lives in a named volume (`helpdesk-postgres-data`), so it persists across `docker compose down` / `up` cycles.

- Stop: `docker compose down`
- Wipe everything: `docker compose down -v`
- Connect with `psql`: `docker exec -it helpdesk-postgres psql -U postgres -d helpdesk`

The Prisma schema is in [`backend/prisma/schema.prisma`](./backend/prisma/schema.prisma). The generated client lives at `backend/src/generated/prisma` (gitignored).
