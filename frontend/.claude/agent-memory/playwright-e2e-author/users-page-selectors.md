---
name: users-page-selectors
description: Reliable selectors and patterns for the /users page CRUD tests
metadata:
  type: project
---

See the root-level memory at `C:\Users\grantt\Desktop\helpdesk\.claude\agent-memory\playwright-e2e-author\users-page-selectors.md` for the full entry. Key points:

- `CardTitle` is a `<div>`, not a heading — use `getByText`, not `getByRole("heading")`.
- Always scope dialog field interactions to the dialog locator to avoid strict-mode violations.
- Use a `rowByEmail` helper (`page.getByRole("row").filter({ has: page.getByText(email, { exact: true }) })`) for row lookups.
- Names must be unique per run (use `Date.now()`) because the test DB is persistent and soft-deleted rows stay.
- Delete confirmation uses `getByRole("alertdialog", { name: "Delete user" })`.
