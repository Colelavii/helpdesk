/**
 * Shared constants for the agent-provisioning helper.
 *
 * The actual provisioning logic lives in backend/src/provision-test-agent.ts
 * and runs as a Bun child process so this file never imports backend source
 * (which would break the root tsconfig's compilation context).
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Absolute path to the backend directory (for `cwd` in execSync). */
export const BACKEND_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../backend",
);

/**
 * Absolute path to the Bun provision script inside the backend.
 * Invoked via execSync as:
 *   bun --env-file=.env.test run <PROVISION_SCRIPT> <email> <password> [name]
 */
export const PROVISION_SCRIPT = path.resolve(
  BACKEND_DIR,
  "src/provision-test-agent.ts",
);
