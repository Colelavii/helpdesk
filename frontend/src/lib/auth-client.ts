import { createAuthClient } from "better-auth/react";

// No baseURL: the browser origin (:5173) + default basePath "/api/auth" is
// proxied to the backend (:3001) by Vite, matching the server's basePath.
export const authClient = createAuthClient();

export const { signIn, signOut, useSession } = authClient;
