import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { APIError } from "better-auth/api";
import { prisma } from "./prisma.ts";

// Comma-separated list of browser origins allowed to call the auth API
// (e.g. the Vite dev server in dev, the deployed frontend in prod).
const trustedOrigins = (process.env.TRUSTED_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

if (trustedOrigins.length === 0) {
  throw new Error("TRUSTED_ORIGINS must be set (comma-separated list of allowed origins)");
}

const isProduction = process.env.NODE_ENV === "production";

export const auth = betterAuth({
  basePath: "/api/auth",
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: { enabled: true, disableSignUp: true },
  user: {
    additionalFields: {
      // input: false — role can't be set via the API; only assigned server-side (e.g. the seed).
      role: { type: ["admin", "agent"], required: true, defaultValue: "agent", input: false },
    },
  },
  databaseHooks: {
    session: {
      create: {
        // Block sign-in for soft-deleted users: the Prisma adapter would
        // otherwise happily authenticate a row that still exists. Mirrors
        // Better Auth's own banUser enforcement. deletedAt is queried directly
        // (not a Better Auth field) so it stays out of the session/user object.
        before: async (session) => {
          const user = await prisma.user.findUnique({
            where: { id: session.userId },
            select: { deletedAt: true },
          });
          if (user?.deletedAt) {
            throw new APIError("FORBIDDEN", {
              message: "This account has been deactivated.",
            });
          }
        },
      },
    },
  },
  rateLimit: {
    // Only throttle in production; dev/test would otherwise trip limits during
    // rapid iteration and e2e runs. (Better Auth's own default is also
    // production-only, but we gate it explicitly so the intent is unambiguous.)
    enabled: isProduction,
    window: 60,
    max: 100,
    customRules: {
      // Tighter cap on credential sign-in to slow brute-force attempts. Path is
      // relative to basePath, i.e. POST /api/auth/sign-in/email.
      "/sign-in/email": { window: 60, max: 5 },
    },
  },
  trustedOrigins,
});
