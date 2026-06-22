/**
 * Test-only helper script: provisions a fresh agent-role user via Better Auth's
 * internal adapter. Called by the Playwright auth fixture as a Bun child process
 * so the e2e root tsconfig never needs to resolve backend imports.
 *
 * Usage: bun --env-file=.env.test run src/provision-test-agent.ts <email> <password> [name]
 *
 * Idempotent: deletes any existing user with the given email before creating a
 * fresh one, so repeated runs against the same disposable test DB stay clean.
 *
 * Why a standalone script rather than a shared module: sign-up is disabled in
 * this app, so agents can only be provisioned server-side. Keeping this in a
 * separate process lets the Playwright test files stay completely decoupled
 * from the backend compilation context.
 */

import { auth } from "./auth.ts";
import { prisma } from "./prisma.ts";

const email = process.argv[2];
const password = process.argv[3];
const name = process.argv[4] ?? "Test Agent";

if (!email || !password) {
  console.error(
    "Usage: provision-test-agent.ts <email> <password> [name]",
  );
  process.exit(1);
}

// Remove any leftover record so repeated local runs against the same DB are
// clean without needing a full DB reset between runs.
await prisma.user.deleteMany({ where: { email } });

const ctx = await auth.$context;
const passwordHash = await ctx.password.hash(password);

// role defaults to "agent" via the schema default; we cannot pass it through
// the auth API (input: false), but the internal adapter has no such restriction.
const user = await ctx.internalAdapter.createUser({
  email,
  name,
  emailVerified: true,
});

await ctx.internalAdapter.linkAccount({
  userId: user.id,
  providerId: "credential",
  accountId: user.id,
  password: passwordHash,
});

// Print the user id so the caller can capture it if needed.
console.log(user.id);
process.exit(0);
