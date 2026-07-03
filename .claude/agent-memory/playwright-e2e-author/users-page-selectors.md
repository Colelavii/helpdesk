---
name: users-page-selectors
description: Reliable selectors and patterns for the /users page CRUD tests
metadata:
  type: project
---

## CardTitle is a <div>, not a heading

`CardTitle` in `frontend/src/components/ui/card.tsx` renders as a `<div data-slot="card-title">`, not an `<h*>` element. Use `page.getByText("...", { exact: true })` not `getByRole("heading", { name: "..." })`.

**Always use `{ exact: true }` on `getByText` for CardTitle values.** Without it, a card title like "Support requests" matches descriptive text like "Student support requests assigned to your team." and triggers a strict-mode violation (2 elements found). Confirmed on the Tickets page: `getByText("Support requests")` fails; `getByText("Support requests", { exact: true })` passes. See [[tickets-page-selectors]].

## Strict-mode: scope inputs to the open dialog

The UserFormDialog uses `id="name"`, `id="email"`, `id="password"` on its fields. These IDs exist on both the create and edit form variants, and when other dialogs were previously open on the page the DOM can contain multiple matching labels. Always scope field interactions to the dialog locator:

```ts
const dialog = page.getByRole("dialog", { name: "Create user" });
await dialog.getByLabel("Name").fill(name);
```

## Strict-mode: row lookup must use exact email text

`getByRole("cell", { name })` can match partial text across multiple cells (e.g. the "Edit ..." button label in the actions cell). The safest row locator is:

```ts
function rowByEmail(page, email) {
  return page.getByRole("row").filter({
    has: page.getByText(email, { exact: true }),
  });
}
```

Then scope name/role cell assertions to that row:
```ts
await expect(row.getByRole("cell", { name: "agent", exact: true })).toBeVisible();
```

## Names must be unique per test run (not just emails)

The test DB is persistent across reruns (soft-deleted rows stay). Using a fixed name like "New E2E Agent" causes strict-mode errors when a previous run left a row with that name. Use `Date.now()` in both name AND email:

```ts
function uniqueUser(prefix: string) {
  const ts = Date.now();
  return {
    name: `${prefix} ${ts}`,
    email: `e2e-${prefix.toLowerCase().replace(/\s+/g, "-")}-${ts}@example.com`,
  };
}
```

## AlertDialog role

The delete confirmation uses shadcn `AlertDialog`. Assert with `page.getByRole("alertdialog", { name: "Delete user" })`, not `getByRole("dialog")`.

## Dialog selector names

- Create trigger button: `getByRole("button", { name: "New user" })`
- Create dialog: `getByRole("dialog", { name: "Create user" })`
- Create submit: `dialog.getByRole("button", { name: "Create user" })`
- Edit trigger: `getByRole("button", { name: "Edit <user name>" })`
- Edit dialog: `getByRole("dialog", { name: "Edit user" })`
- Edit submit: `editDialog.getByRole("button", { name: "Save changes" })`
- Delete trigger: `getByRole("button", { name: "Delete <user name>" })`
- Delete alertdialog: `getByRole("alertdialog", { name: "Delete user" })`
- Delete confirm: `alertDialog.getByRole("button", { name: "Delete" })`
- Delete cancel: `alertDialog.getByRole("button", { name: "Cancel" })`

## Admins have no delete button

`UsersTable` only renders `<DeleteUserDialog>` when `user.role !== Role.admin`. To assert its absence for the seeded admin row, scope to the admin row and assert not visible:

```ts
const adminRow = rowByEmail(page, "admin@example.com");
await expect(adminRow.getByRole("button", { name: /^Delete / })).not.toBeVisible();
```
