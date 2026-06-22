---
name: auth-test-harness
description: Confirmed credentials, ports, storageState inheritance gotcha, and key harness facts for auth e2e tests
metadata:
  type: project
---

## Confirmed credentials (backend/.env.test)
- Admin email: `admin@example.com`
- Admin password: `e2e-test-admin-password`
- Admin name (as seeded): `"Admin"` (set in seed.ts, shown in NavBar)

## Test ports
- Frontend: 5273, Backend: 3101, DB: 5433 (helpdesk_test)

## Session / storageState inheritance gotcha
The chromium project sets `storageState: ".auth/admin.json"` globally. This means:
- `browser.newContext()` with NO args inherits admin storageState — must pass `{ storageState: undefined }` for a fresh unauthenticated context
- `playwright.request.newContext()` with NO args also inherits project storageState — must pass `{ storageState: { cookies: [], origins: [] } }` for a truly cookie-free API context
- The `request` fixture shares the browser context's cookie jar (always carries admin session in the chromium project)
- Tests that exercise unauthenticated flows use `test.use({ storageState: { cookies: [], origins: [] } })` at describe-block level

## Setup project
- Auth setup file: `e2e/auth.setup.ts` (logs in as admin, saves to `.auth/admin.json`)
- Setup project defined in playwright.config.ts: `{ name: "setup", testMatch: /.*\.setup\.ts/ }`
- Chromium project depends on setup: `dependencies: ["setup"]`
- `.auth/admin.json` is gitignored via `.auth/.gitignore`

## Root tsconfig change
Added `"allowImportingTsExtensions": true` to root tsconfig.json — required so e2e files can use `.ts` extensions in imports (Bun idiom), consistent with the backend tsconfig.

**Why:** Bun requires `.ts` extensions in imports (verbatimModuleSyntax). The backend tsconfig already had this flag. Root tsconfig needed it too once e2e fixtures imported helpers.
**How to apply:** Any future e2e files can freely use `import foo from "./bar.ts"` pattern.
