---
name: agent-provisioning
description: Location and invocation pattern of the server-side agent user provisioning helper for e2e tests
metadata:
  type: project
---

## Files
- **Backend script** (runs under backend tsconfig): `backend/src/provision-test-agent.ts`
  - Invoked via Bun child process; imports backend/src/auth.ts and prisma.ts directly
  - Uses Better Auth's internal adapter (`auth.$context`) to create users — same pattern as seed.ts
  - Idempotent: deletes any existing user with the given email before creating fresh one
  - CLI: `bun --env-file=.env.test run <path> <email> <password> [name]`
  - Prints created user ID to stdout

- **Shared constants** (root e2e tsconfig): `e2e/helpers/provision-agent.ts`
  - Exports `BACKEND_DIR` and `PROVISION_SCRIPT` paths — no backend imports
  - Keeps the e2e compilation context decoupled from the backend's verbatimModuleSyntax

- **Fixture**: `e2e/fixtures/auth.ts`
  - `agentCredentials` fixture: calls provision script via `execSync`, returns `{ email, password, name }`
  - `agentContext` fixture: provisions an agent, logs in via UI, returns authenticated `BrowserContext`
  - `adminContext` fixture: returns `BrowserContext` with `.auth/admin.json` storageState
  - Must pass `{ storageState: undefined }` to `browser.newContext()` for agent login (avoids inheriting admin storageState)

## Why provision server-side (not via UI)
Sign-up is disabled (`disableSignUp: true` in Better Auth config). There is no public API or UI to create users. Must use `auth.$context.internalAdapter.createUser` + `linkAccount` with `providerId: "credential"`.

## Agent role assignment
The `role` field defaults to `"agent"` in the Prisma schema. Since `input: false` prevents role assignment via the API, but the internal adapter has no such restriction, the role is set via schema default (no explicit role field needed in createUser call).
