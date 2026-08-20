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
  // The API filtering specs in e2e/tickets.spec.ts assert against a spread of
  // statuses and categories that only the demo seeder produces — db:seed alone
  // creates the admin and nothing else. Seeding it here rather than relying on
  // a developer having run it by hand: without this the suite passes or fails
  // on whatever the test DB happened to accumulate, and a `migrate reset`
  // silently takes those specs red. --if-missing keeps repeat runs a no-op.
  run("src/seed-demo-tickets.ts --if-missing");
}
