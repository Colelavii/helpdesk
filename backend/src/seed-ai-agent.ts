import { auth } from "./auth.ts";
import { prisma } from "./prisma.ts";
import { Role } from "./generated/prisma/enums.ts";
import { aiAgentEmail } from "./tickets/ai-agent.ts";

// Creates the "AI" agent — the user inbound tickets are assigned to while the
// auto-resolve worker owns them. Idempotent, like the admin seed.
//
// Separate from seed.ts rather than folded into it because that script requires
// ADMIN_PASSWORD and this user deliberately has none.
const email = aiAgentEmail();

const existing = await prisma.user.findUnique({ where: { email } });
if (existing) {
  console.log(`AI agent ${email} already exists (id=${existing.id}) — skipping.`);
  process.exit(0);
}

const ctx = await auth.$context;

const user = await ctx.internalAdapter.createUser({
  email,
  name: "AI",
  // Not `admin`: if a way to authenticate this account ever appears, it must not
  // inherit admin authority.
  role: Role.agent,
  emailVerified: true,
});

// No linkAccount, on purpose — this is NOT a missing step. Every other creation
// path (seed.ts, POST /api/users) links a `credential` account with a hashed
// password because those users sign in. This one must not: email/password is the
// only enabled provider and sign-up is disabled, so a user with no credential
// account has no way to authenticate, and no API route can add one.

console.log(
  `Created AI agent: ${user.email} (id=${user.id}) — no password, cannot sign in`,
);
process.exit(0);
