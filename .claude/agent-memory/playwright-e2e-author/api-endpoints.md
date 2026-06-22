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

## Routes that do NOT exist yet
- `GET /api/users` — referenced in implementation plan, NOT implemented. Phase 2 placeholder only (/users page is a heading-only stub). Cannot test server-side 403 for this route yet.

## Auth middleware
- `requireAuth` (`backend/src/require-auth.ts`): resolves session, sets req.user/req.session, 401 if missing
- `requireAdmin` (`backend/src/require-admin.ts`): checks `req.user.role === "admin"`, 403 otherwise. Must be chained after requireAuth.

## Better Auth sign-up endpoint
`POST /api/auth/sign-up/email` — returns HTTP 400+ (observed >=400) when `disableSignUp: true`. Does not create a user.
