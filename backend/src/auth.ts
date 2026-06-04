import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
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

export const auth = betterAuth({
  basePath: "/api/auth",
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  emailAndPassword: { enabled: true, disableSignUp: true },
  user: {
    additionalFields: {
      // input: false — role can't be set via the API; only assigned server-side (e.g. the seed).
      role: { type: ["admin", "agent"], required: false, defaultValue: "agent", input: false },
    },
  },
  trustedOrigins,
});
