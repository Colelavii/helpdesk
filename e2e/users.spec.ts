/**
 * User management e2e tests — happy-path CRUD coverage for the admin-only
 * /users page.
 *
 * Authenticated as the seeded admin via the project-level storageState
 * (.auth/admin.json). No `test.use({ storageState: ... })` override is needed;
 * these tests always run with an admin session.
 *
 * Emails AND names use a per-test timestamp suffix so reruns against the
 * persistent test DB never collide with leftover rows from prior runs.
 * (Soft-deleted rows keep their email reserved via the unique constraint.)
 */

import { test, expect } from "@playwright/test";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const BACKEND = "http://localhost:3101";

/** Returns a unique { name, email } pair scoped to a single test run. */
function uniqueUser(prefix: string) {
  const ts = Date.now();
  return {
    name: `${prefix} ${ts}`,
    email: `e2e-${prefix.toLowerCase().replace(/\s+/g, "-")}-${ts}@example.com`,
  };
}

/**
 * Fill the "New user" create form inside the dialog and submit it.
 * Field interactions are scoped to the dialog locator to avoid strict-mode
 * violations (other inputs with the same label may exist in the page DOM).
 */
async function createUser(
  page: import("@playwright/test").Page,
  {
    name,
    email,
    password,
  }: { name: string; email: string; password: string },
): Promise<void> {
  await page.getByRole("button", { name: "New user" }).click();
  const dialog = page.getByRole("dialog", { name: "Create user" });
  await expect(dialog).toBeVisible();

  await dialog.getByLabel("Name").fill(name);
  await dialog.getByLabel("Email").fill(email);
  await dialog.getByLabel("Password").fill(password);
  await dialog.getByRole("button", { name: "Create user" }).click();

  // Wait for the dialog to close (mutation succeeded + query invalidated).
  await expect(dialog).not.toBeVisible();
}

/** Locates the table row that contains a given email (exact text match). */
function rowByEmail(
  page: import("@playwright/test").Page,
  email: string,
) {
  return page.getByRole("row").filter({ has: page.getByText(email, { exact: true }) });
}

// Page chrome (heading, card title, column headers), the empty/loading/error
// states, and which rows expose a delete button are covered against a mocked
// network by frontend/src/pages/UsersPage.test.tsx. Dialog validation, payloads,
// and error handling are covered by CreateUserDialog / UserFormDialog /
// DeleteUserDialog specs. What's left here is the real Better Auth + DB write
// path, which none of those can exercise.

// ─── Create ───────────────────────────────────────────────────────────────────

test.describe("Users page — create", () => {
  test("creates a new agent and shows the row in the table", async ({
    page,
  }) => {
    const { name, email } = uniqueUser("Create Agent");

    await page.goto("/users");
    await createUser(page, { name, email, password: "securepassword1" });

    // The new row must appear.
    const row = rowByEmail(page, email);
    await expect(row).toBeVisible();
    await expect(row.getByRole("cell", { name, exact: true })).toBeVisible();

    // Role is server-assigned; new users always default to "agent".
    await expect(row.getByRole("cell", { name: "agent", exact: true })).toBeVisible();
  });
});

// ─── Update ───────────────────────────────────────────────────────────────────

test.describe("Users page — update", () => {
  test("edits an existing agent's name and reflects the change in the table", async ({
    page,
  }) => {
    const { name: originalName, email } = uniqueUser("Edit Original");
    const updatedName = `Edit Updated ${Date.now()}`;

    await page.goto("/users");
    await createUser(page, {
      name: originalName,
      email,
      password: "securepassword1",
    });

    // Open the edit dialog for the newly created row.
    await page.getByRole("button", { name: `Edit ${originalName}` }).click();
    const editDialog = page.getByRole("dialog", { name: "Edit user" });
    await expect(editDialog).toBeVisible();

    // Fields must be pre-filled; password must be blank.
    await expect(editDialog.getByLabel("Name")).toHaveValue(originalName);
    await expect(editDialog.getByLabel("Email")).toHaveValue(email);
    await expect(editDialog.getByLabel("Password")).toHaveValue("");

    // Update the name.
    await editDialog.getByLabel("Name").clear();
    await editDialog.getByLabel("Name").fill(updatedName);
    await editDialog.getByRole("button", { name: "Save changes" }).click();
    await expect(editDialog).not.toBeVisible();

    // Row must show the new name; old name must be gone from the same row.
    const row = rowByEmail(page, email);
    await expect(row.getByRole("cell", { name: updatedName, exact: true })).toBeVisible();
    await expect(
      row.getByRole("cell", { name: originalName, exact: true }),
    ).not.toBeVisible();
  });

  test("saving with a blank password keeps the current credentials", async ({
    page,
  }) => {
    const { name, email } = uniqueUser("Blank PW");
    const originalPassword = "original-password-1";

    await page.goto("/users");
    await createUser(page, { name, email, password: originalPassword });

    // Open edit dialog, leave password blank, save.
    await page.getByRole("button", { name: `Edit ${name}` }).click();
    const editDialog = page.getByRole("dialog", { name: "Edit user" });
    await expect(editDialog).toBeVisible();
    await editDialog.getByRole("button", { name: "Save changes" }).click();
    await expect(editDialog).not.toBeVisible();

    // Verify the original password still works by hitting the backend directly.
    const loginResp = await page.request.post(
      `${BACKEND}/api/auth/sign-in/email`,
      { data: { email, password: originalPassword } },
    );
    expect(loginResp.status()).toBe(200);
  });
});

// ─── Delete ───────────────────────────────────────────────────────────────────

test.describe("Users page — delete", () => {
  test("deletes an agent and removes the row from the table", async ({
    page,
  }) => {
    const { name, email } = uniqueUser("Delete Target");

    await page.goto("/users");
    await createUser(page, { name, email, password: "securepassword1" });
    await expect(rowByEmail(page, email)).toBeVisible();

    // Open the delete confirmation.
    await page.getByRole("button", { name: `Delete ${name}` }).click();
    const alertDialog = page.getByRole("alertdialog", { name: "Delete user" });
    await expect(alertDialog).toBeVisible();

    // Confirm deletion.
    await alertDialog.getByRole("button", { name: "Delete" }).click();
    await expect(alertDialog).not.toBeVisible();

    // Row must be gone.
    await expect(rowByEmail(page, email)).not.toBeVisible();
  });

});
