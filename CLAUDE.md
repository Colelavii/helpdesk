# Helpdesk — project guide

AI-powered ticket management system for student support. Companion docs in this directory:

- `project-scope.md` — features, statuses, categories, deployment model
- `tech-stack.md` — chosen technologies
- `implementation-plan.md` — phased task list

Read these before making non-trivial changes; they hold decisions that aren't yet expressed in code.

## Tech stack

- **Frontend**: React + TypeScript, React Router, Tailwind CSS, built with Vite
- **Backend**: Express + TypeScript
- **Runtime / package manager**: Bun (not Node + npm)
- **Database**: PostgreSQL via Prisma
- **Authentication**: database-backed sessions (no third-party auth provider)
- **AI**: Anthropic Claude (Haiku 4.5 for classification, Sonnet 4.6 for summaries and draft replies)
- **Email**: Mailgun (inbound webhook + outbound send)
- **Deployment**: Docker

## Repo layout

```
backend/             Express + TypeScript, run on Bun
frontend/            React + TypeScript + React Router, Vite dev server
docker-compose.yml   Local PostgreSQL for development
```

The frontend dev server proxies `/api/*` to the backend at `http://localhost:3001`, so frontend code calls relative paths (e.g. `fetch("/api/hello")`) with no CORS setup.

## Database

- PostgreSQL via `docker compose up -d` at the repo root. Database name: `helpdesk`. Default credentials match `backend/.env.example`.
- Prisma 7 with the **driver-adapter** approach (`@prisma/adapter-pg`). The native engine binary is *not* used — this is intentional for Bun compatibility.
- Schema lives in `backend/prisma/schema.prisma`. Generated client output: `backend/src/generated/prisma` (gitignored). Import client from `./generated/prisma/client.ts` (the `.ts` extension is required by the backend's `verbatimModuleSyntax`).
- Singleton wrapper: `backend/src/prisma.ts`. Always import `prisma` from there — never instantiate `PrismaClient` ad hoc.
- After a schema change: `bun run db:migrate` (creates and applies a migration in dev). For client-only regen: `bun run db:generate`.

## Running locally

Backend (`backend/`):

- `bun install` — install deps
- `bun run dev` — start with hot reload (`bun --watch`)
- `bun run typecheck` — type-check only

Frontend (`frontend/`):

- `bun install` — install deps
- `bun run dev` — Vite dev server (HMR) on `http://localhost:5173`
- `bun run build` — type-check then build
- `bun run typecheck` — type-check only

## Fetching up-to-date documentation

The **context7** MCP server is configured for this project. Use it whenever you need current docs for any library, framework, SDK, API, or CLI tool — including ones you think you know (Bun, Express, React, Prisma, Tailwind, Anthropic SDK, etc.). Your training data may lag behind upstream changes.

Workflow:

1. Call `mcp__context7__resolve-library-id` with the library name and a query describing what you're trying to do.
2. Call `mcp__context7__query-docs` with the returned library ID and a specific question.

Use context7 for: API syntax, configuration, version migrations, setup instructions, CLI usage, library-specific debugging.

Don't use it for: business-logic debugging, refactoring, code review, or general programming concepts.

## Conventions

- **Bun, not npm**: never suggest `npm install` / `npm run`. Use `bun install` / `bun run`. Lockfile is `bun.lock`.
- **ESM only**: both backend and frontend are `"type": "module"`. Use `import` syntax, not `require`.
- **TypeScript strict**: don't loosen `strict` or disable rules to make code compile. Fix the types.
- **Validate at boundaries**: validate request bodies with Zod (or equivalent) at API handlers. Trust internal types between modules.
- **API routes are prefixed `/api`**: anything served by Express that the frontend fetches lives under `/api/*` so the Vite proxy routes it correctly. Health check is `/api/health`.
- **No comments explaining *what***: identifiers should be self-describing. Only comment the non-obvious *why* (a constraint, a workaround, an invariant).

## Where we are in the plan

See `implementation-plan.md` for the full phased breakdown. The scaffold currently in place corresponds to **Phase 1 — Foundation & Setup**, minus Tailwind, which is still to come.

When picking up new work, check `implementation-plan.md` to see which phase the task belongs to and what its prerequisites are.

## Open decisions (not yet resolved in code)

These are documented at the bottom of `implementation-plan.md`. Flag any work that would silently commit to one of these choices:

- Reopen behaviour on closed tickets when a student replies
- Whether AI auto-assigns category or only suggests it
- Routing for refund-request tickets
- Attachment storage policy
- PII redaction before embedding past tickets
- LLM data residency constraints
