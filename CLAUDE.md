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
- **AI**: Anthropic Claude via the official `@anthropic-ai/sdk` (Haiku 4.5 for classification, Sonnet 5 for summaries and draft replies)
- **Email**: Postmark — inbound webhook and outbound send are both implemented
- **Background jobs**: pg-boss (PostgreSQL-backed queue, no Redis) — used for AI ticket classification, auto-resolution, and sending outbound email
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
- Prisma **6** (`@prisma/client`: 6), constructed plainly in `backend/src/prisma.ts` — no driver adapter, no `@prisma/adapter-pg`. The generated client **does** use the native query engine (`src/generated/prisma/query_engine-windows.dll.node`).
- ⚠️ **Never run `prisma generate --no-engine`** here. It regenerates the client in Prisma Accelerate mode, and every query then fails with `P6001: the URL must start with the protocol prisma://`. It looks like a tempting workaround for the next item, and it silently breaks the whole backend.
- ⚠️ On Windows, `prisma generate` fails with `EPERM … rename query_engine-windows.dll.node.tmpNNNN` while a dev server is running — the running process holds the DLL open. Stop anything started with `bun run dev`, delete the stale `query_engine-windows.dll.node*` files (they're generated and gitignored), then re-run `bun run db:generate`.
- Schema lives in `backend/prisma/schema.prisma`. Generated client output: `backend/src/generated/prisma` (gitignored). Import client from `./generated/prisma/client.ts` (the `.ts` extension is required by the backend's `verbatimModuleSyntax`).
- Singleton wrapper: `backend/src/prisma.ts`. Always import `prisma` from there — never instantiate `PrismaClient` ad hoc.
- After a schema change: `bun run db:migrate` (creates and applies a migration in dev). For client-only regen: `bun run db:generate`.

## Background jobs (pg-boss)

Deferred work runs through **pg-boss**, a job queue backed by the same PostgreSQL database — no Redis, no extra service.

- Singleton wrapper: `backend/src/queue.ts` exports `boss` plus `startQueue()` / `stopQueue()`. Always import `boss` from there — never construct `PgBoss` ad hoc. Note the import is **named** (`import { PgBoss } from "pg-boss"`), not a default.
- **pg-boss owns its own `pgboss` schema** and creates it on first `start()` (so the DB user needs DDL rights). It is deliberately *not* in `public`: Prisma migrations then never see the job tables, and `prisma db pull` won't drag them into `schema.prisma`. Nothing about pg-boss goes through Prisma — it has its own small pool (`max: 2`).
- Queue definitions live next to the feature they serve, not in `queue.ts` (which stays generic). `backend/src/tickets/classification-queue.ts` is the reference example: it owns the queue name, the job payload type, `createClassificationQueues()`, the worker handler, and the `enqueue*` helper. `backend/src/tickets/auto-resolve-queue.ts` follows the same shape.
- **A queue must be created before jobs are sent to it** (`boss.createQueue(name, options)`); retry/expiry options are set per queue there and inherited by its jobs. Create a dead-letter queue *before* the queue that references it.
- **Handler contract**: a handler receives an **array** of jobs (`Job<T>[]`), and jobs are fetched one at a time (`batchSize: 1`) because a throw fails the whole batch. **Throw to request a retry**; return normally to complete the job. Errors that retrying cannot fix (e.g. a missing API key) should log and return rather than burn retries into the dead-letter queue.
- **Workers run inside the API process**, started from `backend/src/index.ts` after `startQueue()`. Queue startup failure is caught and logged, not fatal — the API must serve even when background processing is down. `SIGINT`/`SIGTERM` call `stopQueue()` for a graceful drain. Moving workers to their own entrypoint later means calling `registerClassificationWorker()` from that process instead.
- Inspect jobs with SQL: `select state, retry_count, output from pgboss.job where name = '...'`.

## Ticket statuses & AI auto-resolution

`TicketStatus` has five values, and **two of them belong to the auto-resolve worker, not to agents**:

| Status | Owner | Assignee | Meaning |
| --- | --- | --- | --- |
| `new` | worker | AI agent | Just arrived. The default on `Ticket.status`. |
| `processing` | worker | AI agent | Claimed; the model is deciding. |
| `open` | agent | nobody, or the agent who answered it | Needs a human — either escalated by the model, or reopened by a student reply. |
| `resolved` | agent / worker | AI agent if it answered, else the agent | Answered. |
| `closed` | agent | unchanged | No further action expected. |

- **`new` and `processing` are hidden from the ticket list** — and *only* those two. The `where` clause lives in the list handler in `backend/src/routes/tickets.ts`; passing an explicit `?status=` overrides it, so nothing is unreachable. The hidden window is exactly the period the worker still owns the ticket: showing it then would put work in front of an agent that may resolve itself a second later. Once the worker is done the ticket is ordinary history and appears like any other, **whether the AI resolved it or an agent did** — `aiResolvedAt` does not affect list visibility, it is audit data surfaced on the detail page.
- **Agents can't set `new`/`processing`.** The PATCH body uses `agentTicketStatuses` from `@helpdesk/core` (not the full enum), and the detail page's status picker maps over the same list — rendering the current status as a *disabled* item when the worker still owns it, so the trigger isn't blank.
- **The flow**: inbound webhook creates the ticket as `new` → `scheduleTicketAutoResolve` enqueues a job → the worker claims it as `processing` → `resolveTicket` asks Claude whether `backend/knowledge-base.md` fully answers it → on `resolve` above the confidence threshold, an outbound reply is written and the ticket is `resolved` with `aiResolvedAt`/`aiConfidence`/`aiDecision` set; otherwise it goes to `open` with the reason recorded.
- **A ticket must never be stranded in `new` or `processing`** — it would be invisible to every agent with nothing left to move it on. Three paths guard this: a transient failure returns the ticket to `new` so the retry re-claims it; an unfixable one (missing API key, unreadable knowledge base) sends it to `open`; and `scheduleTicketAutoResolve` calls `skipAutoResolve` when no job will ever run (feature disabled, or the queue refused it). The claim also accepts a ticket already in `processing`, so a retry can recover one whose worker died mid-call. **Every path that ends at `open` also clears `assignedToId`**, and each does it in the same `updateMany` as the status change so the two can't drift; the transient path back to `new` deliberately keeps the assignment, since the AI still owns the ticket and the retry re-claims it.

### The AI agent user

Inbound tickets are assigned to a dedicated **"AI" `User`** for the duration of the auto-resolve window, so a ticket never shows a status saying the model owns it next to an empty assignee.

- **Created by `bun run db:seed:ai`** (`backend/src/seed-ai-agent.ts`), idempotent like the admin seed. Identified by email — `AI_AGENT_EMAIL`, default `ai@helpdesk.local` — resolved through `aiAgentEmail()` / `aiAgentId()` in `backend/src/tickets/ai-agent.ts` (lowercased, since Better Auth stores emails lowercased; id cached per process, **on success only**, so seeding it after boot doesn't need a restart).
- **It deliberately has no `credential` account** — the seed calls `createUser` and *not* `linkAccount`. That omission is the mechanism: email/password is the only enabled provider and sign-up is disabled, so an account with no credential row cannot authenticate and no API route can add one. Don't "fix" it. Its role stays `agent`, never `admin`.
- **`aiAgentId()` never throws**, and returns `null` when the user is missing or soft-deleted. Intake is the inbound-email webhook, where a throw would 5xx the mail provider and turn one unseeded row into a redelivery loop on every email. A missing AI user degrades to the pre-feature behaviour (tickets simply arrive unassigned) and cannot strand a ticket. Every *unassign* write is an unconditional `assignedToId: null` needing no lookup at all.
- **It is not assignable by hand**: excluded from `GET /api/tickets/assignees`, and `PATCH /api/tickets/:id` 400s on it. Nothing in the PATCH path enqueues a job, so an AI-assigned ticket would sit there untouched. `UpdateTicket.tsx` therefore renders a *disabled* `SelectItem` for an assignee absent from the fetched list — same trick as `statusOptions`, because Radix renders the matching item's label and the trigger would otherwise claim "Unassigned" on a ticket the AI owns.
- **It is protected from edit and delete**: `PATCH`/`DELETE /api/users/:id` 403 with `"The AI agent cannot be modified"`. The PATCH guard is what makes an email-keyed identity safe — a rename would break the lookup permanently. It still appears in `GET /api/users` (flagged `isAiAgent`, badged "Automated" in the table, with its row controls hidden) so admins know it exists.
- **On reopen, only the AI's grip is released.** The student-reply path in `ingest-inbound-email.ts` fires for agent-resolved tickets too, so the release is a second, narrower `updateMany` inside a `$transaction` scoped to `assignedToId: <ai>` **and** `status: open` — the status condition limits it to a ticket the first statement just reopened, without which a follow-up email arriving mid-auto-resolve would pull the assignment out from under the worker. Net rule: an AI-resolved ticket whose answer didn't hold goes back to the shared pool; an agent-resolved one stays with whoever answered it.

### Resolution time and the dashboard

- **`Ticket.resolvedAt`** is set when a ticket *reaches* `resolved` (the worker's `sendResolution`, or an agent's PATCH), cleared when a student's reply reopens it, and left alone by `closed`. `updatedAt` can't stand in for it — any later edit bumps that, so the duration would drift every time the ticket is touched. Re-PATCHing `resolved` on an already-resolved ticket does **not** restart the clock (`resolvedAtChange` in `routes/tickets.ts`).
- **The dashboard** is `/` (`frontend/src/pages/DashboardPage.tsx`), open to any signed-in staff member, reading `GET /api/tickets/stats` → `ticketStats()` + `ticketsPerDay()` in `backend/src/tickets/ticket-stats.ts`. Both aggregates ship in one response (`{ stats, daily }`) because the page renders them together — splitting them would only add a second loading state. `ticketStats` is one raw-SQL statement with `count(…) FILTER` aggregates plus an `avg` over the date difference: Prisma can't `AVG` an interval, and once that query exists, four separate Prisma counts alongside it would be more code for more round-trips. Note the `::int` casts (the pg adapter returns `bigint`, which `JSON.stringify` throws on) and `::float8` (numeric arrives as a string).
- **The 30-day chart** (`frontend/src/components/TicketsPerDayChart.tsx`) is hand-rolled from divs — no charting library, deliberately: 30 bars did not justify adding Recharts to a bundle already over 700 kB. Two things about it are load-bearing:
  - `ticketsPerDay()` drives its result from `generate_series`, **not** from the ticket rows, so a day with no tickets returns 0 instead of vanishing — grouping the table alone would close the gap and misdate every bar after it. It buckets in **UTC** (`now() AT TIME ZONE 'utc'`) and returns the day as a `to_char` string, because `current_date` would bucket by the DB session's timezone and a `Date` would be re-read in the browser's — either one can shift a ticket into the neighbouring bar. The `TicketsPerDay.day` string must be formatted with `timeZone: "UTC"` on the client for the same reason.
  - Chart conventions worth keeping if you touch it: one colour for every bar (colouring by height double-encodes what the bar's length already says), a hover **and focus** readout with the count leading, the whole column as the hit target (a quiet day's bar is a pixel tall), a `<details>` table view so no value is reachable only by pointer, and x-axis dates spaced evenly rather than by a fixed stride — a stride leaves a remainder that collides the last two labels.
- **Metric definitions carry two deliberate choices.** "Resolved by AI" requires `aiResolvedAt IS NOT NULL AND status IN (resolved, closed)`, not `aiResolvedAt` alone — that column is retained as audit data after a reopen, so counting it alone would headline tickets sitting in an agent's queue and could exceed the resolved count. And the percentage is over *concluded* tickets, not the total, so it measures how the model does on tickets that reached an outcome rather than tracking the size of the backlog. Both derived figures are `null` (rendered `—`) rather than `0` when there's nothing to divide by.
- ⚠️ The backfill in `add_ticket_resolved_at` falls back to `updatedAt`, which on a row never modified after creation equals `createdAt`. `fix_resolved_at_backfill` nulls those: a zero duration isn't a fast resolution, it's an absence of evidence, and `avg` skips nulls.
- **Knowledge base**: `backend/knowledge-base.md`, loaded and cached by `backend/src/tickets/knowledge-base.ts` (resolved relative to the source, not the cwd; override with `KNOWLEDGE_BASE_PATH`). It ships in the system prompt behind a `cache_control` breakpoint since it is byte-identical on every job. Its §10 escalation rules are policy, not code — edit the markdown, not the prompt.
- **Env**: `AUTO_RESOLVE_ENABLED`, `AUTO_RESOLVE_MODEL`, `AUTO_RESOLVE_CONFIDENCE_THRESHOLD`, `SUPPORT_EMAIL`, `SUPPORT_NAME`, `AI_AGENT_EMAIL` — see `backend/.env.example`.
- **The auto-resolve reply is emailed** like an agent's, through the `email-send` queue — see "Outbound email (Postmark)". It is stored as an outbound `Message` first; the send is a separate job, enqueued only after the resolving transaction commits.

## Inbound email (Postmark)

Email arrives over a webhook and becomes a ticket. **Only inbound is built** — see the Phase 4 note at the bottom.

- **Two routes, one contract.** `backend/src/routes/webhooks.ts` exposes `POST /api/webhooks/inbound-email` (our own provider-neutral JSON shape, used by seeds/tests/curl) and `POST /api/webhooks/postmark/inbound` (the real Postmark payload). The Postmark route validates the payload, maps it through `postmarkToInboundEmail` in `backend/src/tickets/postmark-inbound.ts`, then validates *that* against `inboundEmailSchema` before calling the same `ingestInboundEmail`. Keep the ingest logic provider-agnostic: adding a second provider should mean a second adapter, not a branch inside ingest.
- **The Postmark route answers 200, never 201.** Postmark retries anything that isn't a 200 for up to six hours (10 attempts), so a created ticket replying 201 would be delivered repeatedly. Its `status` (`created` / `threaded` / `deduped`) still ships in the body.
- **`MessageID` in a Postmark payload is not the email's `Message-Id`** — it's Postmark's delivery UUID. The RFC one lives in the flat `Headers: [{Name, Value}]` array, along with `In-Reply-To` and `References`, and header names must be matched case-insensitively (clients send both `Message-ID` and `Message-Id`). The adapter prefers the header (threading only works on it) and falls back to Postmark's UUID so a redelivery of an email with no `Message-Id` still dedupes.
- **Message-Ids are stored bracket-stripped**, normalized by `inboundEmailSchema` so *both* routes agree. Threading compares an incoming `In-Reply-To` against stored `messageId`s — if one side kept the `<…>` and the other didn't, every reply would silently open a new ticket. `References` is one whitespace-separated string in the header; the adapter splits it and keeps the **last** `MAX_REFERENCES` (nearest ancestors match best).
- **The adapter clips, it doesn't reject.** A rejected payload is a support request nobody answers, so an over-long subject/body is truncated to `inboundEmailLimits` (with a visible notice on the body) rather than 400ing. `fromName` falls back to the address' local part, because plenty of clients send no display name and the contract requires a non-empty one. Over-cap HTML is *omitted* rather than clipped — half a document renders as if it were whole, and the plain-text body carries the same words. **`inboundEmailLimits.body` is 1000 characters, which is short for real support email; raising `MAX_BODY_LENGTH` is a one-line change if truncation notices start showing up.**
- **Attachments are dropped** — attachment storage is still an open decision, and the adapter must not commit the project to one.
- **Auth is a shared secret, not a signature** (`backend/src/require-inbound-secret.ts`): Postmark does not sign inbound webhooks. Its documented options are credentials in the webhook URL plus, optionally, a firewall allow-list of Postmark's IPs. Since Postmark cannot set a request header, the guard accepts the secret three ways — `X-Inbound-Secret`, `?secret=`, or HTTP basic auth (the password half; the username is ignored). Prefer basic auth in production, since query strings land in access logs. It rejects with **401 rather than 403 on purpose**: a 403 makes Postmark abandon the webhook permanently, while a retried 401 still delivers the backlog once a half-rotated secret is fixed.
- **The webhooks router is mounted *above* `app.use(express.json())`** in `backend/src/index.ts` and parses its own bodies — a Postmark payload carries the full HTML part plus base64 attachments and blows past the 100kb default, which would 413 a student's email before any handler ran. Its limit is `INBOUND_EMAIL_MAX_SIZE` (default `10mb`). This is the same mount-order trick Better Auth needs, for an unrelated reason; keep both above that line.
- **Env**: `INBOUND_EMAIL_SECRET` (required — the server throws on startup without it), `INBOUND_EMAIL_MAX_SIZE` (optional). See `backend/.env.example`.

## Outbound email (Postmark)

Agent replies and AI auto-resolutions are emailed to the student. The write and the send are deliberately separate steps.

- **The request never waits on Postmark.** `POST /api/tickets/:id/messages` stores the `Message` row and calls `enqueueEmailSend`; the `email-send` queue (`backend/src/tickets/email-queue.ts`, same shape as the other two queues) does the sending. The AI path does the same from `sendResolution`. The job carries only `messageRowId` — the row is the single source of truth, so nothing in the job can go stale.
- **The auto-resolve path enqueues *after* its transaction commits**, never inside it. A worker that picked the job up mid-transaction could mail a student a reply whose transaction then rolled back.
- **`enqueueEmailSend` never throws.** The reply is already committed, so a queue that refuses the job must not turn a successful request into an error — it records `deliveryError` on the message instead, which is what puts it in front of an agent.
- **Delivery state lives on `Message`**: `sentAt` (Postmark accepted it) and `deliveryError` (last failure, cleared by a later success). Neither set means it hasn't left — queued, sending unconfigured, or a reply predating this feature. `MessageThread.tsx` badges outbound messages accordingly ("Delivery failed" with the reason, or "Not sent"); a delivered reply gets no badge, since labelling the normal case says nothing.
- **Retry classification is the heart of the worker.** A missing token and an `ApiInputError`/`InvalidAPIKeyError` from Postmark (bad address, deactivated recipient, rejected token) are recorded and the job *completes* — retrying cannot fix any of them. Everything else (500, 429, dropped connection) is recorded and rethrown so pg-boss retries with backoff and eventually dead-letters.
- ⚠️ **Delivery is at-least-once, not exactly-once.** A message with `sentAt` set is skipped, which makes a job redelivered *after* that write a no-op (a crash or job expiry before pg-boss acked it, or a second `enqueueEmailSend` for the same row). It does **not** close the window between the send and the write: if Postmark accepts the message and the `sentAt` update then fails — or the process dies in between — the retry sends a second copy. Postmark's `/email` has no idempotency key, so there is nothing cheap to fix this with; the same minted `Message-Id` goes out on the retry, which *may* let a recipient's client collapse the duplicate, but Postmark rewrites that header unless `X-PM-KeepID` is honoured, so it is not a guarantee. `outbound-email.test.ts` pins the behaviour in "re-sends when the send succeeded but recording it failed" — that test documents the gap deliberately; don't "fix" it by asserting the opposite.
- **We mint the Message-Id, Postmark doesn't give us one.** The send API returns its own delivery UUID, not an RFC `Message-Id`, and the id has to exist before the send so it can be stored on the row. `newOutboundMessageId()` in `backend/src/tickets/outbound-message.ts` generates it, rooted in `SUPPORT_EMAIL`'s domain, stored bare so it compares equal to the bracket-stripped ids the inbound side normalizes to.
- **Postmark replaces a custom `Message-ID` header** unless `X-PM-KeepID: true` is sent with it. Its docs only describe this for SMTP, but a real send on 2026-08-26 confirmed it works through the Email API too: the delivered message carried our `Message-Id: <…@coleencodes.com>` intact, with Postmark's own id alongside it in `X-PM-Message-Id`. Keep sending both headers. Threading still does **not** depend on it: `replyThreadHeaders` puts the *student's* own earlier ids in `References`, their client echoes the chain back, and `ingestInboundEmail` matches on any id in it — so a future Postmark change here degrades nothing.
- **From is always the support identity, never the agent's own address** — Postmark only sends From a verified sender signature, and a staff mailbox isn't one. The agent's name still travels as the display name, and `Message.fromEmail` keeps their address for attribution, so the thread shows who wrote it while the student sees support@.
- ⚠️ **Reply-To is the Postmark inbound address (`POSTMARK_INBOUND_ADDRESS`), and must never be the From address.** This is the return path for the entire conversation. A verified sender signature is typically a real mailbox or a forwarding alias, so a reply to the From lands in a person's inbox and the helpdesk never sees it — the thread just stops. This was a live bug: the first delivered test email carried `Reply-To: imat@coleencodes.com`, a Porkbun alias forwarding to Gmail, so any customer reply would have bypassed the webhook. Note Postmark **defaults Reply-To to From when we send none**, so leaving this unset is not neutral; `send-email.ts` warns on every send when it's missing, and warns again if it matches the From.
- **Env**: `POSTMARK_SERVER_TOKEN` (absent → nothing is emailed and each reply is marked not delivered; dev needs no token), `POSTMARK_MESSAGE_STREAM` (default `outbound`), `POSTMARK_FROM_EMAIL` (the verified sender; falls back to `SUPPORT_EMAIL`, then `support@example.com`), `POSTMARK_INBOUND_ADDRESS` (the Reply-To — see above), `SUPPORT_NAME`. **One address serves as the From, the AI's stored attribution, and the minted `Message-Id` domain** — if it isn't the verified signature, every send is rejected with `code 300`.
- **While a Postmark account is pending approval it only accepts recipients on the From address' own domain.** A send to anyone else comes back as an `ApiInputError`, so it is already handled the right way — recorded on the message, job completed, no retries burned. Don't add addressing workarounds for it; it clears when the account is approved.
- **Tests**: `backend/src/tickets/outbound-email.test.ts` covers send-email, the queue worker and the threading chain in **one** spec, mocking only the Postmark SDK, Prisma and pg-boss. That is not tidiness — `mock.module` is global in bun, so a spec that stubbed `send-email.ts` to test the queue would replace the module another spec was testing for real. Splitting this file will break it.

## Authentication

Better Auth (email/password only), configured in `backend/src/auth.ts` with the Prisma adapter.

- **Mounted before `express.json()`**: the handler is `app.all("/api/auth/*splat", toNodeHandler(auth))` in `backend/src/index.ts`. Keep it above the JSON body parser — mounting it after makes the auth client hang.
- **Sign-up is disabled** (`disableSignUp: true`): users are provisioned server-side only. The admin comes from `bun run db:seed` (reads `ADMIN_EMAIL` / `ADMIN_PASSWORD`; idempotent).
- **Create users via Better Auth, never raw Prisma writes**: passwords must be hashed with Better Auth's own hasher. The seed shows the pattern — `auth.$context` → `ctx.internalAdapter.createUser` + `ctx.password.hash` + `linkAccount` with `providerId: "credential"`. The one exception is the AI agent (`bun run db:seed:ai`), which omits `linkAccount` precisely so it can't sign in — see "The AI agent user" above.
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
- `bun run db:seed` — the admin user; `bun run db:seed:ai` — the AI agent inbound tickets are assigned to (both idempotent)

Frontend (`frontend/`):

- `bun install` — install deps
- `bun run dev` — Vite dev server (HMR) on `http://localhost:5173`
- `bun run build` — type-check then build
- `bun run typecheck` — type-check only

## Testing (e2e)

Playwright drives the full stack (frontend + backend + DB) from the **repo root** (`playwright.config.ts`, root `package.json`, specs in `e2e/`).

**Prefer component tests (Vitest) as the default; use e2e only when necessary.** Component tests are fast and cover most behavior — rendering, UI states, validation, and mutations with the network mocked. Reserve e2e for cases that genuinely need the real full stack: auth/session flows, server-side enforcement (route guards, status codes), or a critical cross-boundary path (e.g. the inbound-email webhook, ticket intake). Do **not** add e2e *proactively* just because a user-facing flow shipped — cover it with component tests instead, and only reach for e2e when a case truly warrants it or the user asks.

### The e2e minimality rule

**If a component test (or a plain unit test) can cover a behaviour, it must not also be an e2e test.** Every e2e case has to justify itself by testing something that is impossible to test at a lower level. Apply this both when adding tests and when touching an existing spec — if you notice redundancy, delete it.

An e2e test earns its place only if it depends on at least one of:

- **A real session/cookie** — sign-in, sign-out, session persistence across reload, tampered or absent cookies, role-gated redirects driven by an actual server session.
- **Server-side enforcement** — status codes and rejections the server decides: 401/403, 404 from `parseId`, 400 from a Zod body/query guard, whitelists (e.g. the `sort` field allow-list).
- **Real persistence** — a write that must survive a reload or be visible through a second request; anything that must round-trip through Postgres (soft deletes, Better Auth password hashing, webhook threading/idempotency).
- **A genuine cross-boundary path** — the inbound-email webhook creating a ticket that then renders in the browser; one smoke test per flow, not one per assertion.

Do **not** write an e2e test for any of these — they belong in `frontend/src/**/*.test.tsx`:

- Static rendering: headings, card titles, column headers, labels, "this control is visible".
- Client-side form validation and its messages (react-hook-form + zod), including "no request was sent".
- Loading skeletons, empty states, and error copy for a failed request (mock the rejection instead).
- Which query params a control sends — assert the request, and let a separate API-level e2e test prove the server honours them. Don't drive both halves through the browser.
- Dialog open/close/cancel behaviour, and row-level affordances (e.g. which rows show a delete button).
- Anything asserting CSS classes or purely visual styling.

When trimming an e2e test that covers real behaviour with no component-test equivalent, **port it down rather than dropping it** — move the case into the relevant `*.test.tsx`, confirm it passes there, then delete the e2e version. Never reduce total coverage in the name of this rule.

Keep the reasoning discoverable: when a spec deliberately omits an obvious case, leave a short comment naming the component test that owns it (see the header comments in `e2e/ticket-detail.spec.ts` and `e2e/users.spec.ts`).

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

See `implementation-plan.md` for the full phased breakdown.

- **Phase 1 — Foundation & Setup**: complete (Tailwind v4 + shadcn/ui included).
- **Phase 2 — Authentication**: complete. Better Auth email/password, protected + admin-guarded routes, admin seed.
- **Phase 3 — Tickets**: list with server-side sort/filter/search/pagination, detail page with thread, reply composer, status/category/assignee editing.
- **AI features**: reply polish, ticket summary, category classification, and auto-resolution — all on Claude via pg-boss workers.
- **Phase 7 — User Management & Dashboard**: user CRUD is done (`/users`, admin-only, soft delete). The dashboard is done and lives at `/` — five headline metrics from `GET /api/tickets/stats`. Still open in this phase: counts by category, today/week buckets, and the sidebar nav (it's a top nav today).
- **Phase 4 — Email (Postmark)**: inbound and outbound both work — see "Inbound email (Postmark)" and "Outbound email (Postmark)" above. Mail arrives at `POST /api/webhooks/postmark/inbound`, and agent and AI replies go out through the `email-send` queue with threading headers, so a student's reply lands back on the same ticket. Still open in the phase: attachments (dropped on the way in, never sent on the way out), spam filtering, and a tunnel-based local dev recipe in the README.

When picking up new work, check `implementation-plan.md` to see which phase the task belongs to and what its prerequisites are.

## Open decisions (not yet resolved in code)

These are documented at the bottom of `implementation-plan.md`. Flag any work that would silently commit to one of these choices:

- ~~Reopen behaviour on closed tickets when a student replies~~ — **settled**: the inbound webhook reopens a `resolved`/`closed` ticket to `open` (`ingest-inbound-email.ts`). Now load-bearing: it is how a student gets a human after an AI-resolved ticket. **Assignment on reopen is settled too**: an AI-resolved ticket is released to the shared pool, an agent-resolved one stays with the agent who answered it.
- Whether AI auto-assigns category or only suggests it
- ~~Routing for refund-request tickets~~ — **settled**: knowledge-base §10 escalates chargebacks, disputed charges, and refunds outside the 30-day window to a human, and an escalated ticket is left **unassigned** for whoever picks it up — for every category, not just refunds. Per-category routing would need a rule the app doesn't have (there are no teams or queues yet).
- Attachment storage policy
- PII redaction before embedding past tickets
- LLM data residency constraints
