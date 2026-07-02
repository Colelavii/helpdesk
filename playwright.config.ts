import { defineConfig, devices } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Load backend/.env.test into the Playwright runner process so specs can read
// vars like INBOUND_EMAIL_SECRET and API_BASE_URL from process.env.
// The child processes (backend, frontend webServer) already receive it via
// `bun --env-file=.env.test`; this covers the runner itself (which runs under
// Node, not Bun, and therefore does not get --env-file auto-loading).
const __dirname = dirname(fileURLToPath(import.meta.url));
const envTestPath = resolve(__dirname, "backend/.env.test");
for (const line of readFileSync(envTestPath, "utf-8").split("\n")) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eq = trimmed.indexOf("=");
  if (eq === -1) continue;
  const key = trimmed.slice(0, eq).trim();
  const value = trimmed.slice(eq + 1).trim();
  // Never overwrite a variable the caller already set in their shell environment.
  if (!(key in process.env)) process.env[key] = value;
}

// Dedicated test ports so the e2e stack can run alongside `bun run dev`
// (dev uses 5173 / 3001 / 5432; test uses 5273 / 3101 / 5433).
const FRONTEND_URL = "http://localhost:5273";
// BACKEND_URL is now authoritative from the env file; fall back to the
// hard-coded value only if the env file somehow lacked it.
const BACKEND_URL = process.env.API_BASE_URL ?? "http://localhost:3101";

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./global-setup.ts",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "html",
  use: {
    baseURL: FRONTEND_URL,
    trace: "on-first-retry",
  },
  projects: [
    // Setup project: logs in as the seeded admin once and saves the session to
    // .auth/admin.json. All spec projects that depend on "setup" start with
    // that storageState pre-loaded, so the login flow itself is tested only in
    // the tests that explicitly clear storageState.
    {
      name: "setup",
      testMatch: /.*\.setup\.ts/,
    },

    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: ".auth/admin.json",
      },
      dependencies: ["setup"],
    },
  ],
  // Two servers. DB migrate + seed happen in globalSetup (not here), so these
  // just start the apps; the frontend proxies /api to the test backend via
  // BACKEND_URL. Prerequisite: postgres-test must be running (`bun run test:db:up`).
  webServer: [
    {
      command: "bun --env-file=.env.test run start",
      cwd: "backend",
      url: `${BACKEND_URL}/api/health`,
      name: "backend (test DB)",
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
      stdout: "pipe",
      stderr: "pipe",
    },
    {
      command: "bun run dev -- --port 5273 --strictPort",
      cwd: "frontend",
      url: FRONTEND_URL,
      name: "frontend (test)",
      env: { BACKEND_URL },
      timeout: 120_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
