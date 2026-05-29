# Helpdesk

AI-powered ticket management system. See [`project-scope.md`](./project-scope.md), [`tech-stack.md`](./tech-stack.md), and [`implementation-plan.md`](./implementation-plan.md).

## Layout

```
backend/    Express + TypeScript, run on Bun
frontend/   React + TypeScript + React Router, built with Vite (run on Bun)
```

## Prerequisites

Install [Bun](https://bun.com) (v1.1+). On Windows in PowerShell:

```powershell
powershell -c "irm bun.sh/install.ps1 | iex"
```

Restart your terminal, then verify:

```powershell
bun --version
```

## First-time setup

From the repo root:

```powershell
cd backend
bun install
cp .env.example .env

cd ..\frontend
bun install
```

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

The Vite dev server proxies `/api/*` to the backend, so the frontend can call `fetch("/api/hello")` directly with no CORS configuration.

Visit `http://localhost:5173` — the home page should show "Backend says: Hello from the helpdesk backend".

## Scripts

Backend (`backend/`):

- `bun run dev` — start with hot reload
- `bun run start` — start once, no watcher
- `bun run typecheck` — type-check without emitting

Frontend (`frontend/`):

- `bun run dev` — Vite dev server with HMR
- `bun run build` — type-check and build for production
- `bun run preview` — preview the production build
- `bun run typecheck` — type-check only
