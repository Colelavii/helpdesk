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
core/                Shared TypeScript consumed by both (Zod schemas + inferred types)
docker-compose.yml   Local PostgreSQL for development
```

`backend` and `frontend` are independent Bun installs (each has its own `bun.lock` / `node_modules`), not a workspace. `core` is published as `@helpdesk/core` and wired into both via a `file:../core` dependency (Bun symlinks it). It exports `.ts` source directly — both Bun and Vite transpile it on the fly, so there's no build step.

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

Playwright drives the full stack (frontend + backend + DB) from the **repo root** (`playwright.config.ts`, root `package.json`, specs in `e2e/`).

**Prefer component tests (Vitest) as the default; use e2e only when necessary.** Component tests are fast and cover most behavior — rendering, UI states, validation, and mutations with the network mocked. Reserve e2e for cases that genuinely need the real full stack: auth/session flows, server-side enforcement (route guards, status codes), or a critical cross-boundary path (e.g. the inbound-email webhook, ticket intake). Do **not** add e2e *proactively* just because a user-facing flow shipped — cover it with component tests instead, and only reach for e2e when a case truly warrants it or the user asks.

**When you do write e2e, always use the `playwright-e2e-author` agent** — launch it via the Agent tool (`subagent_type: "playwright-e2e-author"`); never hand-write Playwright specs inline. The agent owns the authoritative harness details (test DB on port 5433, isolated ports, `globalSetup` seeding, `.env.test` credentials, run commands) and the project's testing conventions; its definition lives at `.claude/agents/playwright-e2e-author.md`.

## Testing (component)

Frontend component/unit tests run under **Vitest** with **jsdom** and **React Testing Library**, inside `frontend/` (separate from the root-level Playwright e2e suite). Specs are colocated with the code as `src/**/*.test.tsx`. **This is the default test layer — reach for it first when adding coverage for new work.**

- **Run** (from `frontend/`): `bun run test` (one-shot, `vitest run`) or `bun run test:watch` (watch mode). Typecheck specs with `bun run typecheck:test`.
- **Config**: `frontend/vitest.config.ts` (jsdom env, React plugin, `@` alias, `setupFiles`). `frontend/vitest.setup.ts` registers jest-dom matchers (`@testing-library/jest-dom/vitest`) and runs `cleanup()` after each test.
- **TS**: specs and `src/test/**` are excluded from `tsconfig.app.json` and type-checked via `tsconfig.test.json` instead, so test-only deps stay out of the app build.
- **Shared render helper**: use `renderWithClient(ui)` from `src/test/render.tsx` — it wraps the tree in a fresh `QueryClient` (with `retry: false` so error states surface immediately). It also imports the jest-dom matcher augmentation, so importing it keeps `toBeInTheDocument` etc. typed even in editors that don't load `vitest.setup.ts`.
- **Conventions**: user-centric queries (`getByRole`/`getByText`), `findBy*` to await query results, and jest-dom matchers. Mock network calls with `vi.spyOn(axios, ...)` rather than hitting a real backend — full-stack flows belong in the Playwright e2e suite. `UsersPage.test.tsx` is the reference example (loading/success/empty/error states).

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
- **Validate at boundaries**: validate request bodies with Zod (or equivalent) at API handlers. Trust internal types between modules. Don't hand-roll the `schema.safeParse(req.body)` + `z.flattenError` + `res.status(400)` guard in each handler — use the shared `parseBody(schema, req.body, res)` helper from `backend/src/parse-body.ts`: it 400s with the flattened error and returns the typed data (or `null` to early-return), so a handler starts with `const data = parseBody(schema, req.body, res); if (!data) return;`.
- **Parse integer route params with `parseId`**: for numeric `:id` params, don't hand-roll the `Number(req.params.id)` + `Number.isInteger` + `res.status(404)` guard — use the shared `parseId(value, res, notFoundError?)` helper from `backend/src/parse-id.ts`. It 404s with the given message (default `"Not found"`; pass a resource-specific one like `"Ticket not found"`) and returns the number, or `null` after responding, so a handler starts with `const id = parseId(req.params.id, res, "Ticket not found"); if (id === null) return;`. It's resource-agnostic — reuse it for any integer id param. (Better Auth user ids are strings, so this only applies to numeric ids.)
- **Shared Zod schemas live in `core`**: any schema (and its inferred type) used by both the client and the server must be defined once in `@helpdesk/core` (`core/src/schemas/*.ts`, re-exported from `core/src/index.ts`) and imported from there in both — never copy-paste a schema into `backend` and `frontend`. The server validates request bodies with it; the client drives form validation off the *same* schema (e.g. `zodResolver(createUserSchema)`) and derives form value types from the exported `z.infer` type (e.g. `CreateUserInput`). `createUserSchema` is the reference example. Keep `zod` versions aligned across `core`, `backend`, and `frontend`. A schema used by only one side can stay local to that package.
- **Use the `Role` enum, not role strings**: in client code never hardcode the `"admin"` / `"agent"` role literals. Import `Role` from `@helpdesk/core` (defined in `core/src/role.ts`) and use `Role.admin` / `Role.agent` for comparisons and types (e.g. `user.role === Role.admin`, `role: Role`). Its string values match the database / API, so it's interchangeable with the raw strings — always prefer the enum. (Backend DB code uses Prisma's generated `Role` from `./generated/prisma/enums.ts`, which carries the same values.)
- **API routes are prefixed `/api`**: anything served by Express that the frontend fetches lives under `/api/*` so the Vite proxy routes it correctly. Health check is `/api/health`.
- **No comments explaining *what***: identifiers should be self-describing. Only comment the non-obvious *why* (a constraint, a workaround, an invariant).
- **UI via shadcn/ui**: theme is `radix-vega` with `neutral` base color (`frontend/components.json`) — Radix primitives, not Base UI; don't change this without asking. Add components with `bunx --bun shadcn@latest add <component>`. Note the v4 CLI quirks: `--preset` takes a bare style name (`vega`), base is `-b radix`, and `-d/--defaults` silently forces the Next.js template.
- **Semantic color tokens only**: never use raw Tailwind palette classes (`gray-*`, `blue-*`, `red-*`, …) in frontend code. Use theme tokens: `bg-background`, `bg-muted`, `text-foreground`, `text-muted-foreground`, `text-destructive`, etc. Page background is `bg-muted`; surfaces are `Card`s.
- **Data fetching via TanStack Query + axios**: in frontend code, fetch server data with `@tanstack/react-query` (`useQuery`/`useMutation`), not bare `fetch` or `useEffect` request loops. Use `axios` as the HTTP client inside query/mutation functions, and pass TanStack's `signal` to axios so requests cancel on unmount. The `QueryClientProvider` is wired up in `frontend/src/main.tsx`. (Better Auth flows still go through the auth client, not axios.)
- **Build the ticket detail query key with `ticketQueryKey`**: import it from `frontend/src/lib/query-keys.ts` instead of writing `["ticket", id]` inline. The detail query is keyed while only the route param is known (a string), but code invalidating it from a loaded ticket holds a numeric `ticket.id` — `ticketQueryKey` stringifies so the two never drift, which would silently stop the thread from re-fetching.
- **Render errors with `ErrorMessage` / `FieldError`**: never hand-roll `<p className="text-sm text-destructive">` in frontend code. Import from `frontend/src/components/ErrorMessage.tsx`: `ErrorMessage` (default export) for a failed request or action — it renders `role="alert"`, which the component tests query via `findByRole("alert")` — and the named `FieldError` for react-hook-form validation messages, which deliberately has **no** `role="alert"` (the input's `aria-invalid` conveys the state, and a live region per field would re-announce on every keystroke; it would also break the single-alert test queries). Both render nothing for an empty/undefined message, so pass the message straight through instead of guarding at the call site: `<FieldError>{errors.email?.message}</FieldError>`, `<ErrorMessage>{errors.root?.message}</ErrorMessage>`. Extra classes go through `className` (e.g. `<ErrorMessage className="mt-4">`).
- **Derive mutation error copy with `apiErrorMessage`**: don't re-implement the `axios.isAxiosError(error) && typeof error.response?.data?.error === "string"` ternary in each `onError`. Use `apiErrorMessage(error, fallback)` from `frontend/src/lib/api-error.ts` — it surfaces the backend's `{ error: string }` message and falls back to the given copy for network failures or unexpected payloads: `setError("root", { message: apiErrorMessage(error, "Unable to send your reply. Please try again.") })`.

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
