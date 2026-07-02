---
name: env-loading-in-runner
description: How backend/.env.test is loaded into the Playwright runner process so specs can read process.env vars
metadata:
  type: feedback
---

The Playwright runner runs under Node, not Bun. `bun --env-file=.env.test` only applies to the child processes (backend, frontend webServer), NOT the runner itself. Without extra handling, `process.env.INBOUND_EMAIL_SECRET` etc. are undefined inside spec code.

**Solution (in place since June 2026):** `playwright.config.ts` reads `backend/.env.test` with `readFileSync` at module-evaluation time, parsing it line-by-line into `process.env`. This happens before any spec module is loaded. The parser skips blank lines and comments and never overwrites a variable already set by the caller's shell.

**Why not dotenv:** dotenv is not installed at the repo root (root `package.json` only has `@playwright/test`, `@types/node`, `typescript`). The inline parser avoids adding a dependency.

**Canonical env vars exposed to specs via this mechanism:**
- `API_BASE_URL` — base URL of the test backend (e.g. `http://localhost:3101`)
- `INBOUND_EMAIL_SECRET` — shared secret for the inbound-email webhook
- All other vars in `backend/.env.test` (ADMIN_EMAIL, ADMIN_PASSWORD, etc.) are also available

**Pattern for specs:** read from `process.env` and throw a descriptive error if missing — never hardcode values that live in the env file. See `e2e/inbound-email.spec.ts` for the reference implementation.

See also: [[auth-test-harness]] for seeded admin credentials.
