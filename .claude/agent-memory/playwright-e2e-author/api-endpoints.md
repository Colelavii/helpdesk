---
name: api-endpoints
description: Backend API routes that exist, their auth requirements, and what is missing (for test planning)
metadata:
  type: project
---

## Existing routes (backend/src/index.ts as of Phase 2)
- `GET /api/health` — public, no auth required, returns `{ status: "ok", uptime: number }`
- `GET /api/me` — requireAuth, returns `{ user: { email, role, ... } }`, 401 if no session
- `POST /api/auth/*` — Better Auth handler (sign-in, sign-out, session management)

## Webhook routes
- `POST /api/webhooks/inbound-email` — guarded by `requireInboundSecret` middleware (X-Inbound-Secret header). NOT session-authenticated.
  - Returns 201 `{ ticketId, status: "created" }` for new tickets
  - Returns 200 `{ ticketId, status: "threaded" }` for replies (matched via inReplyTo or references array)
  - Returns 200 `{ ticketId, status: "deduped" }` for duplicate messageId
  - Returns 400 `{ error: <flattened Zod error> }` for validation failures
  - Returns 401 `{ error: "Unauthorized" }` for missing/wrong secret
  - Secret in `.env.test`: `INBOUND_EMAIL_SECRET=e2e-test-inbound-secret`
  - Test file: `e2e/inbound-email.spec.ts`

## Ticket routes (Phase 2+)
- `GET /api/tickets` — requireAuth (any signed-in staff, NOT admin-only). Returns `{ tickets: [...] }`, ordered `createdAt DESC` (newest first).
  - Each ticket: `{ id: number, subject: string, requesterEmail: string, requesterName: string, status: string, category: string | null, createdAt: string, updatedAt: string }`
  - 401 with no session, 200 with any valid session (admin or agent)
  - Tested in `e2e/tickets.spec.ts`

## Routes that do NOT exist yet
- `GET /api/tickets/:id` — not yet implemented. Cannot assert per-ticket DB state (reopen-on-reply behavior) from e2e tests until this exists.

## Auth middleware
- `requireAuth` (`backend/src/require-auth.ts`): resolves session, sets req.user/req.session, 401 if missing
- `requireAdmin` (`backend/src/require-admin.ts`): checks `req.user.role === "admin"`, 403 otherwise. Must be chained after requireAuth.

## Better Auth sign-up endpoint
`POST /api/auth/sign-up/email` — returns HTTP 400+ (observed >=400) when `disableSignUp: true`. Does not create a user.
