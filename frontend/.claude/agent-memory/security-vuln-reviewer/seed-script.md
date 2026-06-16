---
name: seed-script
description: How admin user is provisioned, weak default credentials in .env.example
metadata:
  type: project
---

`backend/src/seed.ts` correctly creates the admin user via `auth.$context` → `ctx.internalAdapter.createUser` + `ctx.password.hash` + `linkAccount`. This is the right pattern — it does NOT bypass Better Auth's hasher.

**Issue**: `backend/.env.example` ships with `ADMIN_PASSWORD=password123`. This is a weak default that developers may forget to change before seeding a production database.

**Why:** Developers commonly copy .env.example to .env and run the seed without changing defaults. If that happens in production, the admin account has a trivially guessable password.

**How to apply:** Flag any proposal to use .env.example default credentials. Recommend the .env.example ADMIN_PASSWORD be replaced with a placeholder like `CHANGE-ME-before-seeding`.
