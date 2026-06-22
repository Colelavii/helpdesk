import { defineConfig, devices } from "@playwright/test";

// Dedicated test ports so the e2e stack can run alongside `bun run dev`
// (dev uses 5173 / 3001 / 5432; test uses 5273 / 3101 / 5433).
const FRONTEND_URL = "http://localhost:5273";
const BACKEND_URL = "http://localhost:3101";

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
