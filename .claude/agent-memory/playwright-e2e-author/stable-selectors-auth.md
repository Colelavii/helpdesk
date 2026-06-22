---
name: stable-selectors-auth
description: Confirmed stable Playwright selectors for the login page, NavBar, and post-login state (verified against running app)
metadata:
  type: project
---

## Login page (/login)
- Email field: `page.getByLabel("Email")` — <Label htmlFor="email"> + <Input id="email">
- Password field: `page.getByLabel("Password")` — <Label htmlFor="password"> + <Input id="password">
- Submit button: `page.getByRole("button", { name: "Sign in" })`
- Server-side credential error: `page.getByRole("alert")` — rendered as `<p role="alert">` when Better Auth returns an error
- Zod validation errors (field-level, before submit hits network):
  - Invalid/empty email: `page.getByText("Enter a valid email address")`
  - Empty password: `page.getByText("Password is required")`

## NavBar (authenticated)
- User name display: `page.getByText("Admin")` for the seeded admin (span with session.user.name)
- Sign out button: `page.getByRole("button", { name: "Sign out" })`
- Nav links: `page.getByRole("link", { name: "Home" })`, `page.getByRole("link", { name: "Tickets" })`, `page.getByRole("link", { name: "Users" })` (admin-only)

## Post-login routes
- Login success → navigates to `/` (HomePage): h1 "Helpdesk"
- /users (UsersPage): `page.getByRole("heading", { name: "Users" })` — bare h1 placeholder
- /tickets (TicketsPage): `page.getByRole("heading", { name: "Tickets" })` — uses shadcn Card

## Route redirect behaviour (client-side)
- Unauthenticated → ProtectedRoute → `/login` (replace)
- Authenticated → LoginRoute redirects `/login` → `/` (replace)
- Non-admin agent → AdminRoute → `/` (replace)
- Unknown routes → `<Navigate to="/" replace />`
