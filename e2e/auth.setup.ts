/**
 * Admin authentication setup — runs once before any spec that depends on the
 * "setup" project. Logs in as the seeded admin via the UI and persists the
 * browser storage state to .auth/admin.json for reuse across the suite.
 *
 * Credentials come from backend/.env.test (committed; disposable test DB only):
 *   ADMIN_EMAIL=admin@example.com
 *   ADMIN_PASSWORD=e2e-test-admin-password
 */

import { test as setup, expect } from "@playwright/test";
import path from "node:path";

const adminAuthFile = path.resolve(".auth/admin.json");

setup("authenticate as admin", async ({ page }) => {
  await page.goto("/login");

  await page.getByLabel("Email").fill("admin@example.com");
  await page.getByLabel("Password").fill("e2e-test-admin-password");
  await page.getByRole("button", { name: "Sign in" }).click();

  // The app navigates to "/" after a successful login.
  await page.waitForURL("/");

  // Confirm the NavBar shows the admin's name so we know the session is real.
  await expect(page.getByText("Admin")).toBeVisible();

  await page.context().storageState({ path: adminAuthFile });
});
