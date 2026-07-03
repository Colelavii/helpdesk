---
name: tickets-page-selectors
description: Reliable selectors and patterns for /tickets page and GET /api/tickets tests
metadata:
  type: project
---

## Page structure

- Page `<h1>`: "Tickets" — `getByRole("heading", { name: "Tickets" })`
- CardTitle: "Support requests" — `getByText("Support requests", { exact: true })`. Must use `exact: true` because the card description "Student support requests assigned to your team." also contains the substring "Support requests" — omitting exact causes a strict-mode violation.
- Table column headers (all `<th>`): Subject, Requester, Status, Category, Received
- Requester cell renders as `"{name} <{email}>"` — locate by email using a regex or text fragment.

## GET /api/tickets — shape and ordering

- Endpoint: `GET /api/tickets` — requireAuth, any session (agent or agent-admin). Returns `{ tickets: [...] }` ordered by `createdAt DESC` (newest first).
- Auth: 401 with no session cookie; 200 with valid admin or agent session.
- Each ticket: `{ id: number, subject: string, requesterEmail: string, requesterName: string, status: string, category: string | null, createdAt: string, updatedAt: string }`
- Seeding pattern: POST to `/api/webhooks/inbound-email` with the admin session's `request` context (inherits session cookies from project storageState); using `playwright.request.newContext` would lose the session cookie and get a 401 if hitting `/api/tickets`.

## Uniqueness and ordering assertions

Because other tickets may exist in the DB, never assert absolute row counts or positions.
Assert relative ordering of your seeded tickets identified by their unique ids or subjects:

```ts
const idx1 = tickets.findIndex((t) => t.id === id1);
const idx2 = tickets.findIndex((t) => t.id === id2);
// id2 was created after id1, so it must appear first (smaller index)
expect(idx2).toBeLessThan(idx1);
```

For the UI ordering test, use `rows.all()` + `textContent()` to find positions without hardcoding counts:

```ts
const allRows = await page.getByRole("row").all();
let idx1 = -1, idx2 = -1;
for (let i = 0; i < allRows.length; i++) {
  const text = await allRows[i].textContent();
  if (text?.includes(subject1)) idx1 = i;
  if (text?.includes(subject2)) idx2 = i;
}
expect(idx2).toBeLessThan(idx1);
```

## Test file

`e2e/tickets.spec.ts` — 6 tests covering: API auth (401 without session), API shape validation, API newest-first ordering, UI heading/card title, UI column headers, UI row presence + requester display, UI relative ordering.

## Webhook seeding via authenticated `request`

The `request` fixture in the chromium project inherits the project-level admin storageState. POST to the webhook using `request.post(WEBHOOK, { headers: { "x-inbound-secret": SECRET }, data: ... })` — this uses the admin session cookies automatically, which is needed when the same test also calls `GET /api/tickets` (which requires auth). See [[env-loading-in-runner]] for how BACKEND and SECRET are loaded.
