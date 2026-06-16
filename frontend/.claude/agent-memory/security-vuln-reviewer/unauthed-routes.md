---
name: unauthed-routes
description: Routes in backend/src/index.ts that lack requireAuth, including /api/db-check which leaks database info
metadata:
  type: project
---

As of the Phase 2 baseline, `backend/src/index.ts` has the following routes without `requireAuth`:

- `GET /api/health` — intentionally public (uptime check)
- `GET /api/hello` — unintentionally public (dev artifact, low risk now, should be removed or gated)
- `GET /api/db-check` — unintentionally public; returns `{ status, userCount }` revealing that the DB is reachable and how many users exist. Should require `requireAuth` at minimum.

`GET /api/me` correctly uses `requireAuth`.

**How to apply:** When adding new routes, confirm whether `requireAuth` is applied. For admin-only routes, both `requireAuth` and `role === "admin"` check are needed (see [[auth-architecture]]).
