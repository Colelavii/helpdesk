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

The backend `.env` defaults to `postgresql://postgres:postgres@localhost:5434/helpdesk?schema=public`, which matches `docker-compose.yml`. The dev DB is published on host port **5434** (not the usual 5432) so it doesn't collide with a native PostgreSQL install that may already own 5432.

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

## Email (Postmark)

Forwarded support email becomes a ticket via `POST /api/webhooks/postmark/inbound`, and replies — an agent's or the AI's — are emailed back to the student.

### Sending

Set `POSTMARK_SERVER_TOKEN` in `backend/.env` (Postmark → Servers → your server → API Tokens) and `POSTMARK_FROM_EMAIL` to an address covered by a **verified sender signature**. Postmark refuses to send From anything else, which is why replies go out From that address rather than the agent's own — the agent's name still appears as the display name. The same address is stored as the AI's attribution and roots the `Message-Id`s we mint, so it should be the real sending identity.

**Without a token nothing is emailed**, and that is a supported way to run in dev: replies are still stored, and the thread marks each one "Not sent". Nothing else degrades.

Sending runs on the `email-send` pg-boss queue rather than in the request, so a Postmark outage is retried instead of losing a reply. Each message records its outcome: `sentAt` when Postmark accepted it, or `deliveryError` with the reason, which the ticket thread shows as a "Delivery failed" badge.

Delivery is **at-least-once**. A reply is never silently dropped, but if Postmark accepts a message and recording that fails, the retry sends a second copy. Postmark's send API has no idempotency key, so this is accepted rather than worked around.

Inspect the queue with:

```powershell
docker exec helpdesk-postgres psql -U postgres -d helpdesk -c "select state, retry_count, output from pgboss.job where name = 'email-send' order by created_on desc limit 5;"
```

Also set `POSTMARK_INBOUND_ADDRESS` to your server's **inbound** address (Servers → your server → Settings → Inbound). It becomes the `Reply-To` on everything sent, and it is what brings a customer's reply back into the helpdesk. It must not be the From address: a verified sender signature is usually a real mailbox or a forwarding alias, so replying to it delivers into someone's inbox and the ticket never hears about it. Postmark defaults `Reply-To` to `From` when none is sent, so leaving this unset silently breaks the return path — the sender warns on every send if it's missing or equal to the From.

Note that a **newly created Postmark account is pending approval** and only accepts recipients on the same domain as the From address. Sends to anyone else are rejected and recorded on the message as a delivery failure; it resolves when the account is approved and needs no code change. (This account was approved on 2026-08-31.)

### Receiving

Postmark does not sign inbound webhooks, so the endpoint is guarded by the shared `INBOUND_EMAIL_SECRET` from `backend/.env`. Carry it in the webhook URL, since Postmark's inbound configuration can't set a request header:

```
https://postmark:<INBOUND_EMAIL_SECRET>@your-host/api/webhooks/postmark/inbound
```

A `?secret=<INBOUND_EMAIL_SECRET>` query string works too, but basic auth is preferable — query strings tend to end up in access logs. Set the URL as the **Inbound webhook** on your Postmark inbound server (Servers → your server → Settings → Inbound), and forward mail to the server's inbound address. In production, optionally restrict the endpoint to [Postmark's IP ranges](https://postmarkapp.com/support/article/800-ips-for-firewalls) as well.

To exercise it locally, expose the backend with a tunnel (`cloudflared tunnel --url http://localhost:3001` or `ngrok http 3001`) and point Postmark at the tunnel URL. Postmark's own **Check** button on the inbound settings page sends a sample payload.

Without a tunnel, replay a payload straight at the local backend. Use `Invoke-RestMethod` rather than `curl` here — PowerShell 5.1 strips the double quotes out of native-command arguments, so an inlined JSON body arrives mangled:

```powershell
$body = @{
  FromFull = @{ Email = "ada@students.edu"; Name = "Ada Student" }
  Subject  = "Cannot log in"
  TextBody = "My password reset link expired."
  Headers  = @(@{ Name = "Message-ID"; Value = "<local-test-1@students.edu>" })
} | ConvertTo-Json -Depth 5

Invoke-RestMethod -Method Post -ContentType "application/json" -Body $body `
  -Uri "http://localhost:3001/api/webhooks/postmark/inbound?secret=<INBOUND_EMAIL_SECRET>"
```

It answers `200` with `{ ticketId, status }` — `created`, `threaded` (matched an existing thread via `In-Reply-To` / `References`), or `deduped` (that `Message-Id` was already ingested). Always 200: Postmark retries anything else for up to six hours.

Inbound attachments are currently discarded, outbound mail carries none, and every inbound email becomes a ticket — spam filtering is not wired up.

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
