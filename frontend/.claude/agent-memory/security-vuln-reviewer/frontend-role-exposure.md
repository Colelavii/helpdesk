---
name: frontend-role-exposure
description: Role field declared as plain string on client (not union type), AdminRoute/NavBar are client-side UX only
metadata:
  type: project
---

`frontend/src/lib/auth-client.ts` declares the `role` field as `{ type: "string" }` in `inferAdditionalFields`, not as a `"admin" | "agent"` union. This means no TypeScript narrowing on the client side (e.g., `session.user.role === "admin"` works but the type doesn't enforce the valid values).

`AdminRoute` (line 9) and `NavBar` (line 29) gate on `session?.user.role === "admin"` — these are correct as UX-only guards and are documented as such. They must never be relied upon for server-side enforcement.

**How to apply:** When reviewing client code, treat all role checks as UX convenience only. The authoritative enforcement must always be on the backend.
