---
name: auth-architecture
description: Trust boundaries, route protection status, requireAdmin gap, role field enforcement — core auth/authz architecture findings
metadata:
  type: project
---

Better Auth (email/password only) is configured in `backend/src/auth.ts`. Key facts:

- `role` additional field has `input: false` — cannot be set through the API. This is correct.
- `TRUSTED_ORIGINS` is enforced at startup (throws if empty). This is correct.
- Better Auth handler is mounted before `express.json()` in `backend/src/index.ts` (line 11 before line 13). This is correct.
- `requireAuth` middleware lives in `backend/src/require-auth.ts` and resolves session cookie. No `requireAdmin` middleware exists yet.
- `AdminRoute` and `ProtectedRoute` in the frontend are documented as client-side UX only — they provide zero server-side enforcement.

**Critical gap**: No `requireAdmin` middleware exists on the backend. As soon as any `/users` API route or other admin-only endpoint is added, it must have both `requireAuth` AND an explicit `role === "admin"` check — there is nothing preventing an authenticated agent from calling those endpoints.

**Currently known unprotected routes**:
- `/api/health` — public, intentional
- `/api/hello` — public, not intentional but low risk
- `/api/db-check` — public, exposes user count, should require auth

**Why:** The absence of `requireAdmin` is a pre-exploitable gap that will become a Critical vulnerability the moment the `/users` API is built.

**How to apply:** When reviewing any new API route, verify both `requireAuth` and an explicit admin role check for admin-scoped functionality. When `requireAdmin` is built, confirm it checks `req.user?.role === "admin"` after `requireAuth` has already run.
