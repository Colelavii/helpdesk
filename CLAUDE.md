# Helpdesk — project guide

AI-powered ticket management system for student support. Companion docs in this directory:

- `project-scope.md` — features, statuses, categories, deployment model
- `tech-stack.md` — chosen technologies
- `implementation-plan.md` — phased task list

Read these before making non-trivial changes; they hold decisions that aren't yet expressed in code.

## Tech stack

- **Frontend**: React + TypeScript, React Router, Tailwind CSS v4 + shadcn/ui, built with Vite
- **Backend**: Express + TypeScript
- **Runtime / package manager**: Bun (not Node + npm)
- **Database**: PostgreSQL via Prisma
- **Authentication**: Better Auth (self-hosted library) with database-backed sessions — no external auth provider
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
- **Dev DB is published on host port 5434**, not 5432: a native PostgreSQL 18 service on this machine owns `localhost:5432` and would otherwise shadow the container (the app would silently use the native server instead). `backend/.env`'s `DATABASE_URL` points at 5434. If auth fails after changing the compose password, the named volume `helpdesk_helpdesk-postgres-data` was initialized with the old password — reset it (`docker compose rm -sf postgres && docker volume rm helpdesk_helpdesk-postgres-data && docker compose up -d --wait postgres`), then re-migrate/seed.
- Prisma 7 with the **driver-adapter** approach (`@prisma/adapter-pg`). The native engine binary is *not* used — this is intentional for Bun compatibility.
- Schema lives in `backend/prisma/schema.prisma`. Generated client output: `backend/src/generated/prisma` (gitignored). Import client from `./generated/prisma/client.ts` (the `.ts` extension is required by the backend's `verbatimModuleSyntax`).
- Singleton wrapper: `backend/src/prisma.ts`. Always import `prisma` from there — never instantiate `PrismaClient` ad hoc.
- After a schema change: `bun run db:migrate` (creates and applies a migration in dev). For client-only regen: `bun run db:generate`.

## Authentication

Better Auth (email/password only), configured in `backend/src/auth.ts` with the Prisma adapter.

- **Mounted before `express.json()`**: the handler is `app.all("/api/auth/*splat", toNodeHandler(auth))` in `backend/src/index.ts`. Keep it above the JSON body parser — mounting it after makes the auth client hang.
- **Sign-up is disabled** (`disableSignUp: true`): users are provisioned server-side only. The admin comes from `bun run db:seed` (reads `ADMIN_EMAIL` / `ADMIN_PASSWORD`; idempotent).
- **Create users via Better Auth, never raw Prisma writes**: passwords must be hashed with Better Auth's own hasher. The seed shows the pattern — `auth.$context` → `ctx.internalAdapter.createUser` + `ctx.password.hash` + `linkAccount` with `providerId: "credential"`.
- **`role` (`admin` | `agent`)** is a Better Auth additional field with `input: false`: it can never be set through the API, only server-side. Default is `agent`.
- **Protecting backend routes**: use `requireAuth` from `backend/src/require-auth.ts`; it resolves the session cookie and sets `req.user` / `req.session` (typed via module augmentation). For admin-only routes, chain `requireAdmin` from `backend/src/require-admin.ts` *after* `requireAuth` (e.g. `app.get("/api/users", requireAuth, requireAdmin, handler)`) — it checks `req.user.role === "admin"` and 403s otherwise. It is authorization only and assumes `requireAuth` already populated `req.user`.
- **Frontend client**: `frontend/src/lib/auth-client.ts` exports `signIn`, `signOut`, `useSession` from `createAuthClient()` — deliberately no `baseURL`, since the Vite proxy maps the default `/api/auth` basePath to the backend. It declares `role` via the `inferAdditionalFields` client plugin (the backend's auth type can't be imported across packages) — keep that declaration in sync with `user.additionalFields` in `backend/src/auth.ts`.
- **Frontend route guards**: `frontend/src/components/ProtectedRoute.tsx` (session required → else `/login`) and, nested inside it, `frontend/src/components/AdminRoute.tsx` (`role === "admin"` → else `/`). These are client-side UX only — any admin-only API still needs server-side enforcement.
- **Rate limiting** (`rateLimit` in `auth.ts`): enabled only when `NODE_ENV === "production"` (off in dev/test so iteration and e2e aren't throttled). Global 100 req/60s across auth routes; credential sign-in (`/sign-in/email`) is tightened to 5/60s. Better Auth keys limits by client IP from the `x-forwarded-for` header — so in production the reverse proxy **must** set/forward it, or all clients share one bucket and per-client throttling won't work. Verified: in production the 6th sign-in returns 429; in dev it never does.
- **Required env vars** (see `backend/.env.example`): `BETTER_AUTH_SECRET` (min 32 chars), `BETTER_AUTH_URL`, and `TRUSTED_ORIGINS` (comma-separated browser origins; the server throws on startup if unset).

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

## Testing (e2e)

Playwright drives the full stack (frontend + backend + DB) and lives at the **repo root** (`playwright.config.ts`, root `package.json`, specs in `e2e/`) because it orchestrates both app packages. No tests are written yet — only the harness.

- **Separate test database**: `postgres-test` in `docker-compose.yml`, behind the `test` profile, on port **5433** (db `helpdesk_test`). It is `tmpfs`-backed — disposable and fully isolated from the dev DB (5434). Start it with `bun run test:db:up`, remove it with `bun run test:db:down`.
- **Isolated ports** so e2e can run alongside `bun run dev`: test backend **3101**, test frontend **5273**, test DB **5433** (dev uses 3001 / 5173 / 5434).
- **Test env**: `backend/.env.test` is **committed on purpose** — it configures only the disposable local test DB and holds no real secrets. The backend loads it via `bun --env-file=.env.test`; its values override the dev `.env`.
- **DB prep runs in `globalSetup`, not the webServer**: `global-setup.ts` runs `db:deploy` + `db:seed` (with `--env-file=.env.test`) once before the suite. This is deliberate — the webServer command is skipped when Playwright reuses an already-running server (`reuseExistingServer`), so seeding there would be unreliable and the admin could silently go missing. `globalSetup` always runs.
- **How a run works**: `playwright.config.ts` defines two start-only `webServer`s — the backend (`bun --env-file=.env.test run start`, port 3101) and Vite on 5273 with `BACKEND_URL=http://localhost:3101` so its `/api` proxy targets the test backend (the proxy target is env-driven in `vite.config.ts`).
- **Run it**: `bun run test:db:up` once (needs Docker), then `bun run test:e2e` (or `test:e2e:ui`) — migrations and the seed admin are applied automatically by `globalSetup`. First-time only: `bunx playwright install chromium`.
- **Manual / standalone**: `bun run test:db:setup` brings the DB up *and* migrates + seeds it, so you can poke the test DB without going through Playwright (the seed admin is `admin@example.com`, see `backend/.env.test`).
- **Root TS config**: the repo root has its own `tsconfig.json` (`types: ["node"]`) covering `playwright.config.ts`, `global-setup.ts`, and `e2e/**` — these use Node APIs, not the backend/frontend configs. Root devDeps add `@types/node` + `typescript`; `bun run typecheck` (from the root) checks them.

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
- **UI via shadcn/ui**: theme is `radix-vega` with `neutral` base color (`frontend/components.json`) — Radix primitives, not Base UI; don't change this without asking. Add components with `bunx --bun shadcn@latest add <component>`. Note the v4 CLI quirks: `--preset` takes a bare style name (`vega`), base is `-b radix`, and `-d/--defaults` silently forces the Next.js template.
- **Semantic color tokens only**: never use raw Tailwind palette classes (`gray-*`, `blue-*`, `red-*`, …) in frontend code. Use theme tokens: `bg-background`, `bg-muted`, `text-foreground`, `text-muted-foreground`, `text-destructive`, etc. Page background is `bg-muted`; surfaces are `Card`s.

## Where we are in the plan

See `implementation-plan.md` for the full phased breakdown. **Phase 1 — Foundation & Setup** is complete (Tailwind v4 + shadcn/ui included). **Phase 2 — Authentication** is underway: Better Auth with email/password login, protected routes, and an admin seed script are in place; the UI (login, nav, layout, tickets placeholder) uses shadcn components throughout. An admin-only `/users` page exists (heading placeholder, guarded by `AdminRoute`; the NavBar shows its link to admins only) — user management itself is not built yet.

When picking up new work, check `implementation-plan.md` to see which phase the task belongs to and what its prerequisites are.

## Open decisions (not yet resolved in code)

These are documented at the bottom of `implementation-plan.md`. Flag any work that would silently commit to one of these choices:

- Reopen behaviour on closed tickets when a student replies
- Whether AI auto-assigns category or only suggests it
- Routing for refund-request tickets
- Attachment storage policy
- PII redaction before embedding past tickets
- LLM data residency constraints
