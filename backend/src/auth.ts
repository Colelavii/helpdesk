import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "./prisma.ts";

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
  // Vite dev server origin; the proxy keeps the browser Origin as :5173.
  trustedOrigins: ["http://localhost:5173"],
});
