import { auth } from "./auth.ts";
import { prisma } from "./prisma.ts";
import { Role } from "./generated/prisma/enums.ts";

const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;

if (!email || !password) {
  throw new Error("ADMIN_EMAIL and ADMIN_PASSWORD must be set");
}

const existing = await prisma.user.findUnique({ where: { email } });
if (existing) {
  console.log(`Admin user ${email} already exists (role=${existing.role}) — skipping.`);
  process.exit(0);
}

// Create the user via Better Auth's internal adapter rather than the sign-up
// endpoint: that endpoint is disabled (disableSignUp), and this lets us assign
// the admin role and hash the password with Better Auth's own hasher.
const ctx = await auth.$context;
const passwordHash = await ctx.password.hash(password);

const user = await ctx.internalAdapter.createUser({
  email,
  name: "Admin",
  role: Role.admin,
  emailVerified: true,
});

await ctx.internalAdapter.linkAccount({
  userId: user.id,
  providerId: "credential",
  accountId: user.id,
  password: passwordHash,
});

console.log(`Created admin user: ${user.email} (id=${user.id}, role=admin)`);
process.exit(0);
