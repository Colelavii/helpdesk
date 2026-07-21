import { test as base, type BrowserContext } from "@playwright/test";
import { execSync } from "node:child_process";
import { BACKEND_DIR, PROVISION_SCRIPT } from "../helpers/provision-agent.ts";

/** Credentials for an agent-role user provisioned for a single test. */
export type AgentCredentials = {
  email: string;
  password: string;
  name: string;
};

type AuthFixtures = {
  /** A browser context already authenticated as the seeded admin. */
  adminContext: BrowserContext;
  /**
   * Provisions a fresh agent user server-side and returns their credentials.
   * The provision script deletes any prior user with the same email before
   * creating a new one, so repeated runs on the same DB stay clean.
   */
  agentCredentials: AgentCredentials;
  /** A browser context authenticated as the freshly provisioned agent user. */
  agentContext: BrowserContext;
};

export const test = base.extend<AuthFixtures>({
  adminContext: async ({ browser }, use) => {
    const context = await browser.newContext({
      storageState: ".auth/admin.json",
    });
    await use(context);
    await context.close();
  },

  agentCredentials: async ({}, use, testInfo) => {
    // Unique email per worker + timestamp prevents inter-test collisions when
    // workers run in parallel and each provisions their own agent user.
    const workerIndex = testInfo.workerIndex;
    const email = `agent-${workerIndex}-${Date.now()}@example.com`;
    const password = "agent-test-password-123";
    const name = `Test Agent ${workerIndex}`;

    execSync(
      `bun --env-file=.env.test run "${PROVISION_SCRIPT}" "${email}" "${password}" "${name}"`,
      { cwd: BACKEND_DIR, stdio: "pipe" },
    );

    await use({ email, password, name });
  },

  agentContext: async ({ browser, agentCredentials }, use) => {
    // Explicitly clear storageState so this context starts with no session,
    // even though the chromium project sets a default admin storageState.
    const context = await browser.newContext({ storageState: undefined });
    const page = await context.newPage();

    await page.goto("/login");
    await page.getByLabel("Email").fill(agentCredentials.email);
    await page.getByLabel("Password", { exact: true }).fill(agentCredentials.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL("/");

    await use(context);
    await context.close();
  },
});

export { expect } from "@playwright/test";
