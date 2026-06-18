import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const backendDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "backend",
);

// Migrate + seed the test DB once before the suite. This lives in globalSetup
// rather than the backend webServer command on purpose: the webServer command
// is skipped when Playwright reuses an already-running server
// (reuseExistingServer), so seeding there is unreliable. globalSetup always
// runs, guaranteeing the schema and seed admin exist for every run.
// Prerequisite: the postgres-test container must be up (`bun run test:db:up`).
export default function globalSetup() {
  const run = (script: string) =>
    execSync(`bun --env-file=.env.test run ${script}`, {
      cwd: backendDir,
      stdio: "inherit",
    });

  run("db:deploy");
  run("db:seed");
}
