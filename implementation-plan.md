# Implementation Plan

Phases are ordered so that each builds on the previous. The principle: get a thin slice working end-to-end (auth → tickets in UI → email in/out → AI on top) before adding the heavier features (RAG, dashboard, prod hardening).

---

## Phase 1 — Foundation & Setup

Goal: a project skeleton that runs locally with Docker and a database connection.

- [ ] Create repo structure: `/backend`, `/frontend`, `/docker`
- [ ] Backend: `package.json`, TypeScript config, ESLint + Prettier, Express with a `/health` endpoint
- [ ] Frontend: scaffold Vite + React + TypeScript, install React Router and Tailwind, render a placeholder home route
- [ ] `docker-compose.yml` for local dev: Postgres service with a named volume
- [ ] Install Prisma in backend, run `prisma init`, verify a no-op migration applies against the Docker Postgres
- [ ] `.env.example` files for backend and frontend (DB URL, session secret, Mailgun keys, Anthropic key placeholders)

## Phase 2 — Authentication & Admin Bootstrap

Goal: an admin can log in and protected routes enforce authentication.

- [ ] Prisma model: `User` (id, email, password_hash, role: `admin` | `agent`, created_at, disabled_at)
- [ ] Prisma model: `Session` (id, user_id, expires_at, created_at)
- [ ] Password hashing utility (bcrypt)
- [ ] Session helpers: create, read, destroy; HTTP-only cookie carrying session id
- [ ] Admin bootstrap: on startup, if no admin exists, create one from `ADMIN_EMAIL` / `ADMIN_PASSWORD` env vars
- [ ] Backend routes: `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`
- [ ] Auth middleware: resolves session cookie to `req.user`, rejects unauthenticated requests
- [ ] Role middleware: `requireAdmin`
- [ ] Frontend: login page, auth context provider, `ProtectedRoute` wrapper, logout control

## Phase 3 — Tickets: Data Model & Manual CRUD

Goal: agents can view and update tickets in the UI. Tickets are still created manually at this stage (no email, no AI).

- [ ] Prisma model: `Ticket` (id, subject, requester_email, requester_name, status: `open` | `resolved` | `closed`, category: `general` | `technical` | `refund`, assigned_to_user_id nullable, created_at, updated_at)
- [ ] Prisma model: `Message` (id, ticket_id, direction: `inbound` | `outbound`, from_email, body, sent_by_user_id nullable, created_at)
- [ ] Seed script with a handful of sample tickets and messages
- [ ] Backend: `GET /tickets` with filter (status, category) and sort (created_at) query params
- [ ] Backend: `GET /tickets/:id` returning the ticket and its messages
- [ ] Backend: `PATCH /tickets/:id` for status / category / assignment changes
- [ ] Backend: `POST /tickets/:id/messages` to record an agent reply (no email sent yet — wired in Phase 4)
- [ ] Zod validation on all request bodies
- [ ] Frontend: ticket list page with filter and sort controls
- [ ] Frontend: ticket detail page showing the thread, status, category, assignment
- [ ] Frontend: status change controls and category dropdown

## Phase 4 — Email Pipeline (Mailgun)

Goal: forwarded emails create tickets, agent replies are actually sent, and student replies thread back to the right ticket.

- [ ] Configure Mailgun domain DNS (SPF, DKIM) and an inbound route pointing at the webhook URL
- [ ] Backend: `POST /webhooks/mailgun/inbound`, verify Mailgun signature
- [ ] Parse inbound payload: subject, from, body, `Message-ID`, `In-Reply-To` / `References`
- [ ] Threading logic: match `In-Reply-To` against stored outbound `Message-ID`s; if matched, append to existing ticket; otherwise create a new ticket
- [ ] Store the outbound `Message-ID` on each sent message
- [ ] Mailgun outbound send helper
- [ ] Wire `POST /tickets/:id/messages` to send via Mailgun (set `In-Reply-To` to most recent inbound `Message-ID`)
- [ ] Attachment handling: decide on store vs. skip; if storing, add `Attachment` model
- [ ] Local dev: expose the webhook with a tunnel (ngrok / cloudflared) and document in the README

## Phase 5 — AI Features (Claude)

Goal: every inbound ticket receives an AI category suggestion, summary, and draft reply, all visible in the detail view.

- [ ] Install `@anthropic-ai/sdk`; add `ANTHROPIC_API_KEY` env var
- [ ] Prisma additions on `Ticket`: `ai_summary`, `ai_suggested_category`, `ai_suggested_reply`, `ai_processed_at`
- [ ] AI service module with `classify(body)`, `summarise(body)`, `draftReply(body, context)`
- [ ] Use Haiku 4.5 for classification; Sonnet 5 for summary and draft
- [ ] After inbound ticket creation, run AI processing (synchronous initially; can move to a job queue later)
- [ ] Ticket detail UI: show AI summary at top, category suggestion as a confirmable dropdown, draft pre-filled in the reply textarea (editable before send)
- [ ] Store the actually-sent reply separately from `ai_suggested_reply` so draft quality can be measured later

## Phase 6 — Knowledge Base from Past Tickets

Goal: AI draft replies use similar resolved tickets as retrieval context.

> **Shipped ahead of this phase**: auto-resolution from a *static* knowledge base
> (`backend/knowledge-base.md`). On arrival a pg-boss job asks Claude whether that
> document fully answers the ticket; if so it writes the reply and resolves the
> ticket, otherwise it escalates to an agent. It adds the `new`/`processing`
> statuses and the `aiResolvedAt`/`aiConfidence`/`aiDecision` columns — see the
> "Ticket statuses & AI auto-resolution" section of `CLAUDE.md`. The retrieval
> work below is complementary: it would give the same job past resolved tickets
> as additional context, rather than replacing the static document.

- [ ] Enable the `pgvector` extension in the Postgres container init script
- [ ] Add an `embedding` column (e.g. `vector(1024)`) on `Ticket`, or a separate `TicketEmbedding` table, via a raw SQL migration
- [ ] Choose an embeddings provider (Voyage AI `voyage-3` recommended); add API key
- [ ] When a ticket transitions to `resolved`, embed `subject + final outbound reply` and store the vector
- [ ] Backfill script to embed any pre-existing resolved tickets
- [ ] Retrieval helper: given a new ticket, return the top-K nearest resolved tickets
- [ ] Update `draftReply` to include the retrieved tickets as context in the prompt
- [ ] PII pass: decide whether to redact names / emails / IDs before embedding

## Phase 7 — User Management & Dashboard

Goal: admin can create and manage agents; every signed-in user gets a useful overview.

- [ ] Backend admin-only endpoints: `GET /users`, `POST /users` (create agent with email + initial password), `PATCH /users/:id` (disable / enable, change role)
- [ ] Frontend admin-only user management page (visible from sidebar only to admins)
- [ ] Backend dashboard endpoint: counts by status, counts by category, tickets created today / week, average time-to-resolve
- [ ] Frontend dashboard page with summary cards
- [ ] Sidebar navigation showing pages permitted by current role

## Phase 8 — Production Deployment

Goal: a reproducible Docker deployment with reasonable observability.

- [ ] Production multi-stage `Dockerfile` for backend
- [ ] Production `Dockerfile` for frontend (build → static serve via nginx, or serve through backend)
- [ ] `docker-compose.prod.yml` with a Postgres volume and env-based secrets
- [ ] Run `prisma migrate deploy` as part of backend container startup
- [ ] Structured logging (pino) + request logging middleware
- [ ] Centralised Express error handler with safe error responses
- [ ] Rate limiting on `/auth/login` and the Mailgun webhook
- [ ] README covering: env vars, first-run admin bootstrap, Mailgun domain setup, Anthropic key setup, how to run migrations

---

## Cross-cutting concerns

These aren't a phase on their own — touch them in whichever phase introduces the relevant code.

- **Tests**: integration tests for auth and ticket CRUD; smoke tests for the AI happy path with a mocked Claude client
- **Audit log**: a `TicketEvent` table from Phase 3 onwards recording status / category / assignment / reply events
- **Error states in UI**: empty states for the ticket list, retry affordances when an AI call fails
- **Dead-letter handling**: log and surface inbound emails that fail to parse, rather than dropping them silently

## Open decisions still to make

These are the calls that shape later phases — worth resolving before Phase 4 or 5 lands.

- ~~Reopen behaviour: does a student reply on a `closed` ticket reopen it, or create a new ticket?~~ **Settled — it reopens.** `ingest-inbound-email.ts` threads the reply onto the existing ticket and moves a `resolved`/`closed` ticket back to `open`. This is now load-bearing: it is the route back to a human after the AI auto-resolves a ticket.
- Who picks the category on intake — AI auto-assigns and agent can override, or AI suggests and agent confirms before the ticket leaves a "new" state?
- Refund-request routing: auto-assign to a specific role / person, or treat like any other category? **Partly settled** — knowledge-base §10 escalates chargebacks, disputed charges, and out-of-window refunds to a human rather than auto-answering them. Whether such a ticket is then auto-*assigned* to anyone is still open.
- Attachments: store, ignore, or virus-scan?
- PII in embeddings: redact requester details before embedding, or accept the risk?
- LLM data residency: any constraint on student data leaving the region via Anthropic?
