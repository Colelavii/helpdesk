# Security Reviewer Memory Index

- [Auth and Authorization Architecture](auth-architecture.md) — trust boundaries, route protection status, requireAdmin gap, role field enforcement
- [Seed Script Security](seed-script.md) — how admin user is created server-side, weak default credentials in .env.example
- [Backend Unauthenticated Routes](unauthed-routes.md) — routes in index.ts that lack requireAuth, including /api/db-check
- [Frontend Role Exposure](frontend-role-exposure.md) — role field declared as plain string on client, AdminRoute is client-side UX only
