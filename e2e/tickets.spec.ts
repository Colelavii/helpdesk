/**
 * Ticket list e2e tests — exercises GET /api/tickets and the /tickets UI.
 *
 * Tickets are seeded via the inbound-email webhook (POST
 * /api/webhooks/inbound-email) so no direct DB access is needed. Each test
 * uses timestamp + counter suffixes to ensure unique messageId, subject, and
 * email values across reruns on the persistent test DB.
 *
 * Test backend: API_BASE_URL from backend/.env.test (default: http://localhost:3101)
 * Webhook secret: INBOUND_EMAIL_SECRET from backend/.env.test
 * Admin session: loaded from .auth/admin.json (project-level storageState)
 */

import { test, expect } from "@playwright/test";

// Guard: both vars are loaded into the runner process by playwright.config.ts
// which reads backend/.env.test before the suite starts. Missing values mean
// the env file was not loaded correctly — fail loudly rather than producing
// confusing errors later.
const BACKEND = process.env.API_BASE_URL;
if (!BACKEND) {
  throw new Error(
    "API_BASE_URL is not set. Ensure playwright.config.ts loads backend/.env.test " +
      "before the Playwright runner starts.",
  );
}
const SECRET = process.env.INBOUND_EMAIL_SECRET;
if (!SECRET) {
  throw new Error(
    "INBOUND_EMAIL_SECRET is not set. Ensure playwright.config.ts loads backend/.env.test " +
      "before the Playwright runner starts.",
  );
}

const WEBHOOK = `${BACKEND}/api/webhooks/inbound-email`;
const TICKETS_API = `${BACKEND}/api/tickets`;

// Monotonically increasing counter ensures uniqueness even when multiple calls
// within a test happen in the same millisecond.
let counter = 0;
function uniqueSuffix(): string {
  counter += 1;
  return `${Date.now()}-${counter}`;
}

// ─── API: auth enforcement ─────────────────────────────────────────────────────

test.describe("GET /api/tickets — auth enforcement", () => {
  test("returns 401 with no session cookie", async ({ playwright }) => {
    const isolated = await playwright.request.newContext({
      storageState: { cookies: [], origins: [] },
    });

    const response = await isolated.get(TICKETS_API);
    expect(response.status()).toBe(401);
    const body = await response.json() as { error: string };
    expect(body.error).toBe("Unauthorized");

    await isolated.dispose();
  });
});

// ─── API: response shape and ordering ─────────────────────────────────────────

test.describe("GET /api/tickets — shape and ordering", () => {
  // The chromium project provides the pre-authenticated admin storageState;
  // `request` in that context inherits the admin session cookies.

  test("each ticket has the expected shape", async ({ request }) => {
    // Seed a ticket so there is guaranteed to be at least one.
    const suffix = uniqueSuffix();
    const seed = await request.post(WEBHOOK, {
      headers: { "x-inbound-secret": SECRET },
      data: {
        fromEmail: `shape-check-${suffix}@example.com`,
        fromName: "Shape Check Student",
        subject: `Shape check ticket ${suffix}`,
        body: "Checking the shape.",
        messageId: `<shape-check-${suffix}@mail.example.com>`,
      },
    });
    expect(seed.status()).toBe(201);

    const response = await request.get(TICKETS_API);
    expect(response.status()).toBe(200);
    const body = await response.json() as { tickets: unknown[] };
    expect(Array.isArray(body.tickets)).toBe(true);
    expect(body.tickets.length).toBeGreaterThan(0);

    // Every ticket must carry the required fields with the right types.
    for (const ticket of body.tickets) {
      const t = ticket as Record<string, unknown>;
      expect(typeof t.id).toBe("number");
      expect(typeof t.subject).toBe("string");
      expect(typeof t.requesterEmail).toBe("string");
      expect(typeof t.requesterName).toBe("string");
      expect(typeof t.status).toBe("string");
      expect(typeof t.createdAt).toBe("string");
      // category is TicketCategory | null — either string or null is valid.
      expect(t.category === null || typeof t.category === "string").toBe(true);
    }
  });

  test("tickets are ordered newest first (by createdAt / id)", async ({
    request,
  }) => {
    // Seed two tickets sequentially. The second is newer and must appear before
    // the first in the response. Using sequential awaits guarantees distinct
    // createdAt timestamps in practice; if they land in the same millisecond,
    // the auto-increment id (which is also monotonic) is used as the tiebreaker.
    const suffix1 = uniqueSuffix();
    const res1 = await request.post(WEBHOOK, {
      headers: { "x-inbound-secret": SECRET },
      data: {
        fromEmail: `order-first-${suffix1}@example.com`,
        fromName: "Order First",
        subject: `Order First Ticket ${suffix1}`,
        body: "First email.",
        messageId: `<order-first-${suffix1}@mail.example.com>`,
      },
    });
    expect(res1.status()).toBe(201);
    const { ticketId: id1 } = await res1.json() as { ticketId: number; status: string };

    const suffix2 = uniqueSuffix();
    const res2 = await request.post(WEBHOOK, {
      headers: { "x-inbound-secret": SECRET },
      data: {
        fromEmail: `order-second-${suffix2}@example.com`,
        fromName: "Order Second",
        subject: `Order Second Ticket ${suffix2}`,
        body: "Second email.",
        messageId: `<order-second-${suffix2}@mail.example.com>`,
      },
    });
    expect(res2.status()).toBe(201);
    const { ticketId: id2 } = await res2.json() as { ticketId: number; status: string };

    // id2 was created after id1 — it must have a higher id (monotonic PK) and
    // must appear at a smaller index in the newest-first list.
    expect(id2).toBeGreaterThan(id1);

    const listResp = await request.get(TICKETS_API);
    expect(listResp.status()).toBe(200);
    const { tickets } = await listResp.json() as { tickets: Array<{ id: number }> };

    const idx1 = tickets.findIndex((t) => t.id === id1);
    const idx2 = tickets.findIndex((t) => t.id === id2);

    // Both tickets must be present.
    expect(idx1).toBeGreaterThanOrEqual(0);
    expect(idx2).toBeGreaterThanOrEqual(0);

    // The newer ticket (id2) must appear before the older one (id1).
    expect(idx2).toBeLessThan(idx1);
  });
});

// ─── UI: /tickets page ────────────────────────────────────────────────────────

test.describe("/tickets page — UI", () => {
  // All tests here rely on the default project-level storageState (admin).

  test("page heading and card title are visible", async ({ page }) => {
    await page.goto("/tickets");
    await expect(page.getByRole("heading", { name: "Tickets" })).toBeVisible();
    // CardTitle renders as a non-heading element. Use exact:true to avoid matching
    // the page description "Student support requests assigned to your team."
    await expect(page.getByText("Support requests", { exact: true })).toBeVisible();
  });

  test("table column headers are visible", async ({ page }) => {
    await page.goto("/tickets");
    const table = page.getByRole("table");
    await expect(table.getByRole("columnheader", { name: "Subject" })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "Requester" })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "Status" })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "Category" })).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "Received" })).toBeVisible();
  });

  test("seeded ticket's subject and requester email appear in the table", async ({
    page,
    request,
  }) => {
    const suffix = uniqueSuffix();
    const subject = `UI visibility ticket ${suffix}`;
    const fromEmail = `ui-requester-${suffix}@example.com`;
    const fromName = "UI Requester";

    // Seed via the webhook using the authenticated request context.
    const seed = await request.post(WEBHOOK, {
      headers: { "x-inbound-secret": SECRET },
      data: {
        fromEmail,
        fromName,
        subject,
        body: "Checking that this ticket appears in the UI.",
        messageId: `<ui-visibility-${suffix}@mail.example.com>`,
      },
    });
    expect(seed.status()).toBe(201);

    await page.goto("/tickets");

    // Subject must appear in a table cell.
    await expect(
      page.getByRole("cell", { name: subject }),
    ).toBeVisible();

    // Requester cell renders "<name> <<email>>"; find by the email fragment.
    await expect(
      page.getByRole("cell", { name: new RegExp(fromEmail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) }),
    ).toBeVisible();
  });

  test("newer seeded ticket's row appears above older one", async ({
    page,
    request,
  }) => {
    const suffix1 = uniqueSuffix();
    const subject1 = `UI Order Older ${suffix1}`;
    const seed1 = await request.post(WEBHOOK, {
      headers: { "x-inbound-secret": SECRET },
      data: {
        fromEmail: `ui-order-older-${suffix1}@example.com`,
        fromName: "UI Order Older",
        subject: subject1,
        body: "Older ticket.",
        messageId: `<ui-order-older-${suffix1}@mail.example.com>`,
      },
    });
    expect(seed1.status()).toBe(201);

    const suffix2 = uniqueSuffix();
    const subject2 = `UI Order Newer ${suffix2}`;
    const seed2 = await request.post(WEBHOOK, {
      headers: { "x-inbound-secret": SECRET },
      data: {
        fromEmail: `ui-order-newer-${suffix2}@example.com`,
        fromName: "UI Order Newer",
        subject: subject2,
        body: "Newer ticket.",
        messageId: `<ui-order-newer-${suffix2}@mail.example.com>`,
      },
    });
    expect(seed2.status()).toBe(201);

    await page.goto("/tickets");

    // Locate both rows by subject cell text.
    const row1 = page.getByRole("row").filter({
      has: page.getByRole("cell", { name: subject1 }),
    });
    const row2 = page.getByRole("row").filter({
      has: page.getByRole("cell", { name: subject2 }),
    });
    await expect(row1).toBeVisible();
    await expect(row2).toBeVisible();

    // Compare DOM positions: the newer ticket (subject2) must appear before the
    // older one (subject1) in the rendered table.
    const rows = page.getByRole("row");
    const allRows = await rows.all();
    let idx1 = -1;
    let idx2 = -1;
    for (let i = 0; i < allRows.length; i++) {
      const text = await allRows[i].textContent();
      if (text?.includes(subject1)) idx1 = i;
      if (text?.includes(subject2)) idx2 = i;
    }

    expect(idx1).toBeGreaterThanOrEqual(0);
    expect(idx2).toBeGreaterThanOrEqual(0);
    // Newer ticket (subject2) must have a lower row index (appears first).
    expect(idx2).toBeLessThan(idx1);
  });
});
