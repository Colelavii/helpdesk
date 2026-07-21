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

## Ticket routes (Phase 2+, all under `ticketsRouter` in `backend/src/routes/tickets.ts`, `requireAuth` applied to the whole router — any signed-in staff, NOT admin-only)
- `GET /api/tickets` — supports `?sort=&order=&status=&category=&search=&page=&pageSize=` (see `ticketsQuerySchema` in `@helpdesk/core`). Returns `{ tickets, total, page, pageSize }`, default order `createdAt DESC`. Invalid `sort`/`status`/`category` values → 400.
  - Each ticket: `{ id: number, subject: string, requesterEmail: string, requesterName: string, status: string, category: string | null, createdAt: string, updatedAt: string }` (no `assignedTo` on the list endpoint)
  - 401 with no session, 200 with any valid session (admin or agent)
- `GET /api/tickets/assignees` — registered before `/:id` so the literal path wins. Returns `{ users: [{ id, name, email }] }`, active (`deletedAt: null`) users only, `orderBy: name asc`. Any signed-in user (not admin-only).
- `GET /api/tickets/:id` — non-integer id → 404 `{ error: "Ticket not found" }`; unknown id → same 404. Found: `{ ticket: { id, subject, requesterEmail, requesterName, status, category, createdAt, updatedAt, assignedTo: {id,name,email}|null, messages: [{id,direction,fromEmail,fromName,body,createdAt}] (oldest first) } }`.
- `PATCH /api/tickets/:id` — body `{ assignedToId: string | null }` (Zod: `assignedToId` non-empty string or null). Assign/unassign a ticket.
  - Non-integer/unknown ticket id → 404 `{ error: "Ticket not found" }` (checked before body validation only for the format check; body validated via `parseBody` first for non-integer ids... actually order in code: id format checked, then body parsed, then existence checked — so a bad id short-circuits to 404 before body validation)
  - Non-existent/invalid `assignedToId` (must reference an active user, `deletedAt: null`) → 400 `{ error: "Assignee not found" }`
  - `assignedToId: null` → unassigns, `ticket.assignedTo` becomes `null`
  - Success → 200 `{ ticket: { ...same shape as GET :id minus messages, assignedTo included } }`
  - 401 with no session cookie
  - Tests: `e2e/tickets.spec.ts`, describe block "PATCH /api/tickets/:id — assignment"

Tested in `e2e/tickets.spec.ts` (list/shape/ordering/sort/filter/UI + assignment describe block above).

## Auth middleware
- `requireAuth` (`backend/src/require-auth.ts`): resolves session, sets req.user/req.session, 401 if missing
- `requireAdmin` (`backend/src/require-admin.ts`): checks `req.user.role === "admin"`, 403 otherwise. Must be chained after requireAuth.

## Better Auth sign-up endpoint
`POST /api/auth/sign-up/email` — returns HTTP 400+ (observed >=400) when `disableSignUp: true`. Does not create a user.
