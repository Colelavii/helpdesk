/**
 * Authentication e2e tests — covers login, logout, validation errors,
 * client-side route guards, and server-side session enforcement.
 *
 * Test DB: helpdesk_test on port 5433 (tmpfs, wiped on container stop).
 * Seeded admin: admin@example.com / e2e-test-admin-password (backend/.env.test).
 * Agent user: provisioned per-test by the agentCredentials fixture.
 *
 * NOTE: /api/users does not exist yet in the backend (Phase 2 placeholder only).
 * Server-side enforcement tests target /api/me (requireAuth, no requireAdmin)
 * and /api/health (public), which do exist. When /api/users is implemented,
 * add tests for its 401/403/200 matrix here.
 *
 * Rate limiting is disabled in NODE_ENV=test — no 429 assertions.
 */

import { test, expect } from "./fixtures/auth.ts";

// ─── Helper ─────────────────────────────────────────────────────────────────

const BACKEND = "http://localhost:3101";

// ─── Login: happy path ───────────────────────────────────────────────────────

test.describe("Login — happy path", () => {
  // These tests exercise the login flow itself, so they use a fresh,
  // unauthenticated page rather than the pre-authenticated storageState.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("admin can sign in and lands on home page", async ({ page }) => {
    await page.goto("/login");

    await page.getByLabel("Email").fill("admin@example.com");
    await page.getByLabel("Password", { exact: true }).fill("e2e-test-admin-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL("/");
    // NavBar shows the user's name after login.
    await expect(page.getByText("Admin")).toBeVisible();
  });

  test("session persists across a full page reload", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("admin@example.com");
    await page.getByLabel("Password", { exact: true }).fill("e2e-test-admin-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("/");

    await page.reload();

    // Still on home page and still authenticated after a hard reload.
    await expect(page).toHaveURL("/");
    await expect(page.getByText("Admin")).toBeVisible();
  });

  test("already-authenticated user visiting /login is redirected to /", async ({
    page,
    adminContext,
  }) => {
    // Use the pre-authenticated admin context; navigate to /login — should
    // redirect immediately to / (LoginRoute checks for existing session).
    const adminPage = await adminContext.newPage();
    await adminPage.goto("/login");
    await expect(adminPage).toHaveURL("/");
  });
});

// ─── Logout ──────────────────────────────────────────────────────────────────

test.describe("Logout", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("sign out clears session and redirects to /login", async ({ page }) => {
    // Sign in first.
    await page.goto("/login");
    await page.getByLabel("Email").fill("admin@example.com");
    await page.getByLabel("Password", { exact: true }).fill("e2e-test-admin-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("/");

    await page.getByRole("button", { name: "Sign out" }).click();

    await expect(page).toHaveURL("/login");
  });

  test("protected routes are inaccessible after sign out", async ({ page }) => {
    // Sign in then sign out.
    await page.goto("/login");
    await page.getByLabel("Email").fill("admin@example.com");
    await page.getByLabel("Password", { exact: true }).fill("e2e-test-admin-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("/");
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.waitForURL("/login");

    // Attempting to navigate to a protected route redirects back to /login.
    await page.goto("/tickets");
    await expect(page).toHaveURL("/login");
  });
});

// ─── Login: validation errors ────────────────────────────────────────────────

test.describe("Login — validation errors", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("wrong password shows credential error", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("admin@example.com");
    await page.getByLabel("Password", { exact: true }).fill("definitely-wrong-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    // Better Auth returns an error; the form renders it in a role="alert" element.
    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page).toHaveURL("/login");
  });

  test("unknown email shows credential error", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("nobody@example.com");
    await page.getByLabel("Password", { exact: true }).fill("some-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByRole("alert")).toBeVisible();
    await expect(page).toHaveURL("/login");
  });

  test("empty email shows zod validation message", async ({ page }) => {
    await page.goto("/login");
    // Leave email blank, fill password, submit.
    await page.getByLabel("Password", { exact: true }).fill("some-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    // react-hook-form + zod renders the field error inline; no network call is made.
    await expect(
      page.getByText("Enter a valid email address"),
    ).toBeVisible();
    await expect(page).toHaveURL("/login");
  });

  test("empty password shows zod validation message", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("admin@example.com");
    // Leave password blank.
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByText("Password is required")).toBeVisible();
    await expect(page).toHaveURL("/login");
  });

  test("malformed email shows zod validation message", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill("not-an-email");
    await page.getByLabel("Password", { exact: true }).fill("some-password");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(
      page.getByText("Enter a valid email address"),
    ).toBeVisible();
    await expect(page).toHaveURL("/login");
  });

  test("both fields empty shows email validation first", async ({ page }) => {
    await page.goto("/login");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(
      page.getByText("Enter a valid email address"),
    ).toBeVisible();
    await expect(page).toHaveURL("/login");
  });
});

// ─── Client-side route guards ────────────────────────────────────────────────

test.describe("Client-side route guards — unauthenticated", () => {
  // Explicitly clear any storageState so these pages start with no session.
  test.use({ storageState: { cookies: [], origins: [] } });

  test("/ redirects to /login when unauthenticated", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL("/login");
  });

  test("/tickets redirects to /login when unauthenticated", async ({
    page,
  }) => {
    await page.goto("/tickets");
    await expect(page).toHaveURL("/login");
  });

  test("/users redirects to /login when unauthenticated", async ({ page }) => {
    await page.goto("/users");
    await expect(page).toHaveURL("/login");
  });
});

test.describe("Client-side route guards — admin", () => {
  // This test group uses the pre-authenticated admin storageState (via the
  // project-level storageState in playwright.config.ts) — no explicit override.

  test("admin can access /users", async ({ page }) => {
    await page.goto("/users");
    await expect(page).toHaveURL("/users");
    await expect(
      page.getByRole("heading", { name: "Users" }),
    ).toBeVisible();
  });

  test("admin NavBar shows Users link", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Users" })).toBeVisible();
  });

  test("admin can navigate to /tickets", async ({ page }) => {
    await page.goto("/tickets");
    await expect(page).toHaveURL("/tickets");
    await expect(
      page.getByRole("heading", { name: "Tickets" }),
    ).toBeVisible();
  });
});

test.describe("Client-side route guards — agent (non-admin)", () => {
  test("agent is redirected from /users to /", async ({
    agentContext,
  }) => {
    const page = await agentContext.newPage();
    await page.goto("/users");
    // AdminRoute redirects non-admin users to /.
    await expect(page).toHaveURL("/");
  });

  test("agent NavBar does not show Users link", async ({ agentContext }) => {
    const page = await agentContext.newPage();
    await page.goto("/");
    await expect(page.getByRole("link", { name: "Users" })).not.toBeVisible();
  });

  test("agent can access /tickets", async ({ agentContext }) => {
    const page = await agentContext.newPage();
    await page.goto("/tickets");
    await expect(page).toHaveURL("/tickets");
  });
});

// ─── Server-side enforcement ──────────────────────────────────────────────────
//
// Client-side guards are UX only. The real security boundary is the backend.
// We test /api/me here because it's the only route that uses requireAuth.
// NOTE: /api/users is not yet implemented in the backend (see file header);
// add its 401/403/200 matrix once it exists.

test.describe("Server-side enforcement — /api/me (requireAuth)", () => {
  test("returns 401 with no session cookie", async ({ playwright }) => {
    // Both `request` (shares browser context cookies) and playwright.request
    // (inherits project storageState) carry the admin session in this project.
    // Pass an explicit empty storageState to get a genuinely cookie-free context.
    const isolated = await playwright.request.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const response = await isolated.get(`${BACKEND}/api/me`);
    expect(response.status()).toBe(401);
    const body = await response.json() as { error: string };
    expect(body.error).toBe("Unauthorized");
    await isolated.dispose();
  });

  test("returns 200 with a valid admin session", async ({
    adminContext,
  }) => {
    const response = await adminContext.request.get(`${BACKEND}/api/me`);
    expect(response.status()).toBe(200);
    const body = await response.json() as { user: { email: string; role: string } };
    expect(body.user.email).toBe("admin@example.com");
    expect(body.user.role).toBe("admin");
  });

  test("returns 200 with a valid agent session", async ({ agentContext, agentCredentials }) => {
    const response = await agentContext.request.get(`${BACKEND}/api/me`);
    expect(response.status()).toBe(200);
    const body = await response.json() as { user: { email: string; role: string } };
    expect(body.user.email).toBe(agentCredentials.email);
    expect(body.user.role).toBe("agent");
  });
});

test.describe("Server-side enforcement — /api/health (public)", () => {
  test("returns 200 with no session", async ({ playwright }) => {
    const isolated = await playwright.request.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const response = await isolated.get(`${BACKEND}/api/health`);
    expect(response.status()).toBe(200);
    await isolated.dispose();
  });
});

// ─── Sign-up disabled ────────────────────────────────────────────────────────

test.describe("Sign-up is disabled", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("no sign-up link or button visible on the login page", async ({
    page,
  }) => {
    await page.goto("/login");
    // There must be no way to navigate to sign-up from the login page.
    await expect(
      page.getByRole("link", { name: /sign.?up|register|create account/i }),
    ).not.toBeVisible();
    await expect(
      page.getByRole("button", { name: /sign.?up|register/i }),
    ).not.toBeVisible();
  });

  test("POST /api/auth/sign-up/email returns an error (sign-up disabled server-side)", async ({
    request,
  }) => {
    const response = await request.post(`${BACKEND}/api/auth/sign-up/email`, {
      data: {
        email: "newuser@example.com",
        password: "SomePassword123!",
        name: "New User",
      },
    });
    // Better Auth returns 422 when disableSignUp is true.
    expect(response.status()).toBeGreaterThanOrEqual(400);
  });

  test("sign-up endpoint rejection does not create a user", async ({
    request,
  }) => {
    const email = `no-signup-${Date.now()}@example.com`;

    await request.post(`${BACKEND}/api/auth/sign-up/email`, {
      data: { email, password: "SomePassword123!", name: "Should Not Exist" },
    });

    // Trying to sign in with those credentials should fail.
    const loginAttempt = await request.post(
      `${BACKEND}/api/auth/sign-in/email`,
      {
        data: { email, password: "SomePassword123!" },
      },
    );
    expect(loginAttempt.status()).toBeGreaterThanOrEqual(400);
  });
});

// ─── Session edge cases ───────────────────────────────────────────────────────

test.describe("Session edge cases", () => {
  test("tampered/invalid session cookie is treated as unauthenticated", async ({
    browser,
  }) => {
    // Start with no storageState, then inject a forged cookie to confirm the
    // backend validates the token and rejects it.
    const context = await browser.newContext({ storageState: undefined });
    // Inject a syntactically valid-looking but forged session cookie.
    await context.addCookies([
      {
        name: "better-auth.session_token",
        value: "totally-invalid-token-value",
        domain: "localhost",
        path: "/",
        httpOnly: true,
        secure: false,
      },
    ]);

    const page = await context.newPage();
    await page.goto("/");
    // ProtectedRoute sees no valid session and redirects to /login.
    await expect(page).toHaveURL("/login");

    const apiResponse = await context.request.get(`${BACKEND}/api/me`);
    expect(apiResponse.status()).toBe(401);

    await context.close();
  });

  test("absent session cookie redirects protected routes to /login", async ({
    browser,
  }) => {
    // Explicitly no storageState — even though the chromium project sets a
    // default admin storageState, we want to test the unauthenticated path.
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();
    await page.goto("/tickets");
    await expect(page).toHaveURL("/login");
    await context.close();
  });
});
