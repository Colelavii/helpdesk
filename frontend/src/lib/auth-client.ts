import { createAuthClient } from "better-auth/react";
import { inferAdditionalFields } from "better-auth/client/plugins";

// No baseURL: the browser origin (:5173) + default basePath "/api/auth" is
// proxied to the backend (:3001) by Vite, matching the server's basePath.
export const authClient = createAuthClient({
  plugins: [
    inferAdditionalFields({
      // Mirrors user.additionalFields in backend/src/auth.ts — the backend's
      // auth type can't be imported across packages, so fields are declared here.
      user: { role: { type: "string" } },
    }),
  ],
});

export const { signIn, signOut, useSession } = authClient;
