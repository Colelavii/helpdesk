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

import { test, expect, type APIRequestContext } from "@playwright/test";

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

// ─── API: server-side sorting ─────────────────────────────────────────────────

test.describe("GET /api/tickets — server-side sorting", () => {
  // Seed three tickets whose subjects start with a unique run token so we can
  // filter the full response down to just this test's rows before asserting
  // order. The token is constructed from the current timestamp plus counter so
  // it is unique across reruns on the persistent test DB.
  //
  // Subjects: "<token> AAA…", "<token> MMM…", "<token> ZZZ…"
  // Alphabetically: AAA < MMM < ZZZ, so asc order is [AAA, MMM, ZZZ].

  async function seedThreeTickets(request: APIRequestContext) {
    const token = `SORT-${uniqueSuffix()}`;
    const subjects = [
      `${token} AAA Alpha ticket`,
      `${token} MMM Middle ticket`,
      `${token} ZZZ Zeta ticket`,
    ] as const;

    const ids: number[] = [];
    for (const [i, subject] of subjects.entries()) {
      const suffix = uniqueSuffix();
      const res = await request.post(WEBHOOK, {
        headers: { "x-inbound-secret": SECRET! },
        data: {
          fromEmail: `sort-student-${suffix}@example.com`,
          fromName: `Sort Student ${i}`,
          subject,
          body: "Sorting test email.",
          messageId: `<sort-seed-${suffix}@mail.example.com>`,
        },
      });
      expect(res.status()).toBe(201);
      const { ticketId } = await res.json() as { ticketId: number; status: string };
      ids.push(ticketId);
    }

    return { token, subjectAAA: subjects[0], subjectMMM: subjects[1], subjectZZZ: subjects[2], ids };
  }

  test("sort=subject&order=asc → seeded tickets appear A→Z by subject", async ({
    request,
  }) => {
    const { ids, token } = await seedThreeTickets(request);
    const idSet = new Set(ids);

    const resp = await request.get(`${TICKETS_API}?sort=subject&order=asc`);
    expect(resp.status()).toBe(200);
    const { tickets } = await resp.json() as { tickets: Array<{ id: number; subject: string }> };

    // Filter to only our seeded rows using the unique token that prefixes every subject.
    // Filtering by subject prefix (not by id) is resilient to parallel test execution:
    // two workers seeding concurrently may receive interleaved ids, making id-to-subject
    // mapping ambiguous, but each worker's token is unique.
    const ours = tickets.filter((t) => t.subject.startsWith(token));
    expect(ours).toHaveLength(3);
    // Verify all three are ours (belt-and-suspenders; the length check above covers it).
    for (const t of ours) expect(idSet.has(t.id)).toBe(true);

    // Ascending subject order: "AAA Alpha" < "MMM Middle" < "ZZZ Zeta".
    expect(ours[0].subject).toContain("AAA");
    expect(ours[1].subject).toContain("MMM");
    expect(ours[2].subject).toContain("ZZZ");
  });

  test("sort=subject&order=desc → seeded tickets appear Z→A by subject", async ({
    request,
  }) => {
    const { ids, token } = await seedThreeTickets(request);
    const idSet = new Set(ids);

    const resp = await request.get(`${TICKETS_API}?sort=subject&order=desc`);
    expect(resp.status()).toBe(200);
    const { tickets } = await resp.json() as { tickets: Array<{ id: number; subject: string }> };

    const ours = tickets.filter((t) => t.subject.startsWith(token));
    expect(ours).toHaveLength(3);
    for (const t of ours) expect(idSet.has(t.id)).toBe(true);

    // Descending subject order reverses to: "ZZZ Zeta" > "MMM Middle" > "AAA Alpha".
    expect(ours[0].subject).toContain("ZZZ");
    expect(ours[1].subject).toContain("MMM");
    expect(ours[2].subject).toContain("AAA");
  });

  test("no sort params → seeded tickets appear newest-first (default unchanged)", async ({
    request,
  }) => {
    // Seed only two tickets to keep the assertion simple; we just need to verify
    // the default ordering (createdAt desc) has not regressed.
    const suffix1 = uniqueSuffix();
    const res1 = await request.post(WEBHOOK, {
      headers: { "x-inbound-secret": SECRET },
      data: {
        fromEmail: `default-sort-a-${suffix1}@example.com`,
        fromName: "Default Sort A",
        subject: `Default sort older ${suffix1}`,
        body: "Older ticket.",
        messageId: `<default-sort-a-${suffix1}@mail.example.com>`,
      },
    });
    expect(res1.status()).toBe(201);
    const { ticketId: id1 } = await res1.json() as { ticketId: number; status: string };

    const suffix2 = uniqueSuffix();
    const res2 = await request.post(WEBHOOK, {
      headers: { "x-inbound-secret": SECRET },
      data: {
        fromEmail: `default-sort-b-${suffix2}@example.com`,
        fromName: "Default Sort B",
        subject: `Default sort newer ${suffix2}`,
        body: "Newer ticket.",
        messageId: `<default-sort-b-${suffix2}@mail.example.com>`,
      },
    });
    expect(res2.status()).toBe(201);
    const { ticketId: id2 } = await res2.json() as { ticketId: number; status: string };

    // id2 was created after id1 — it must have a higher auto-increment id.
    expect(id2).toBeGreaterThan(id1);

    const listResp = await request.get(TICKETS_API);
    expect(listResp.status()).toBe(200);
    const { tickets } = await listResp.json() as { tickets: Array<{ id: number }> };

    const idx1 = tickets.findIndex((t) => t.id === id1);
    const idx2 = tickets.findIndex((t) => t.id === id2);

    expect(idx1).toBeGreaterThanOrEqual(0);
    expect(idx2).toBeGreaterThanOrEqual(0);
    // Newer ticket must appear before the older one.
    expect(idx2).toBeLessThan(idx1);
  });

  test("sort=password&order=asc → 400 (whitelist enforced)", async ({
    request,
  }) => {
    const resp = await request.get(`${TICKETS_API}?sort=password&order=asc`);
    expect(resp.status()).toBe(400);
    const body = await resp.json() as { error: unknown };
    expect(body.error).toBeDefined();
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

// ─── API: server-side filtering ───────────────────────────────────────────────

test.describe("GET /api/tickets — server-side filtering", () => {
  // The demo-ticket seeder creates tickets with varied statuses and categories.
  // These tests assert that filter params are enforced by the server — every
  // ticket in the response must match the requested filter value.
  // No seeding is needed here: the demo data already covers all combinations.

  test("status=open → every ticket in the response is open", async ({
    request,
  }) => {
    const resp = await request.get(`${TICKETS_API}?status=open`);
    expect(resp.status()).toBe(200);
    const { tickets } = await resp.json() as {
      tickets: Array<{ id: number; status: string }>;
    };
    expect(tickets.length).toBeGreaterThan(0);
    for (const t of tickets) {
      expect(t.status).toBe("open");
    }
  });

  test("status=resolved → every ticket in the response is resolved", async ({
    request,
  }) => {
    const resp = await request.get(`${TICKETS_API}?status=resolved`);
    expect(resp.status()).toBe(200);
    const { tickets } = await resp.json() as {
      tickets: Array<{ id: number; status: string }>;
    };
    expect(tickets.length).toBeGreaterThan(0);
    for (const t of tickets) {
      expect(t.status).toBe("resolved");
    }
  });

  test("status=closed → every ticket in the response is closed", async ({
    request,
  }) => {
    const resp = await request.get(`${TICKETS_API}?status=closed`);
    expect(resp.status()).toBe(200);
    const { tickets } = await resp.json() as {
      tickets: Array<{ id: number; status: string }>;
    };
    expect(tickets.length).toBeGreaterThan(0);
    for (const t of tickets) {
      expect(t.status).toBe("closed");
    }
  });

  test("category=technical → every ticket in the response has category technical", async ({
    request,
  }) => {
    const resp = await request.get(`${TICKETS_API}?category=technical`);
    expect(resp.status()).toBe(200);
    const { tickets } = await resp.json() as {
      tickets: Array<{ id: number; category: string | null }>;
    };
    expect(tickets.length).toBeGreaterThan(0);
    for (const t of tickets) {
      expect(t.category).toBe("technical");
    }
  });

  test("category=refund → every ticket in the response has category refund", async ({
    request,
  }) => {
    const resp = await request.get(`${TICKETS_API}?category=refund`);
    expect(resp.status()).toBe(200);
    const { tickets } = await resp.json() as {
      tickets: Array<{ id: number; category: string | null }>;
    };
    expect(tickets.length).toBeGreaterThan(0);
    for (const t of tickets) {
      expect(t.category).toBe("refund");
    }
  });

  test("category=general → every ticket in the response has category general", async ({
    request,
  }) => {
    const resp = await request.get(`${TICKETS_API}?category=general`);
    expect(resp.status()).toBe(200);
    const { tickets } = await resp.json() as {
      tickets: Array<{ id: number; category: string | null }>;
    };
    expect(tickets.length).toBeGreaterThan(0);
    for (const t of tickets) {
      expect(t.category).toBe("general");
    }
  });

  test("status + category compose: status=open&category=refund", async ({
    request,
  }) => {
    const resp = await request.get(`${TICKETS_API}?status=open&category=refund`);
    expect(resp.status()).toBe(200);
    const { tickets } = await resp.json() as {
      tickets: Array<{ id: number; status: string; category: string | null }>;
    };
    expect(tickets.length).toBeGreaterThan(0);
    for (const t of tickets) {
      expect(t.status).toBe("open");
      expect(t.category).toBe("refund");
    }
  });

  test("status=invalid → 400 (enum enforced)", async ({ request }) => {
    const resp = await request.get(`${TICKETS_API}?status=pending`);
    expect(resp.status()).toBe(400);
    const body = await resp.json() as { error: unknown };
    expect(body.error).toBeDefined();
  });

  test("category=invalid → 400 (enum enforced)", async ({ request }) => {
    const resp = await request.get(`${TICKETS_API}?category=billing`);
    expect(resp.status()).toBe(400);
    const body = await resp.json() as { error: unknown };
    expect(body.error).toBeDefined();
  });
});

// ─── UI: /tickets page — filter bar ──────────────────────────────────────────

test.describe("/tickets page — filter bar UI", () => {
  test("status and category filter selects are visible", async ({ page }) => {
    await page.goto("/tickets");
    await expect(
      page.getByRole("combobox", { name: /filter by status/i }),
    ).toBeVisible();
    await expect(
      page.getByRole("combobox", { name: /filter by category/i }),
    ).toBeVisible();
  });

  test("Clear button is not visible before any filter is applied", async ({
    page,
  }) => {
    await page.goto("/tickets");
    // Wait for the table to load before asserting absence of Clear.
    await expect(page.getByRole("table")).toBeVisible();
    await expect(
      page.getByRole("button", { name: /clear all filters/i }),
    ).not.toBeVisible();
  });

  test("selecting a status filter shows only matching rows and reveals Clear", async ({
    page,
  }) => {
    await page.goto("/tickets");
    await expect(page.getByRole("table")).toBeVisible();

    // Open the status select and choose "Resolved".
    await page.getByRole("combobox", { name: /filter by status/i }).click();
    await page.getByRole("option", { name: /^resolved$/i }).click();

    // Every visible status badge must say "resolved".
    const statusCells = page.getByRole("cell").filter({
      has: page.locator('[data-slot="badge"]'),
    });
    const count = await statusCells.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      await expect(statusCells.nth(i)).toHaveText("resolved");
    }

    // Clear button appears once a filter is active.
    await expect(
      page.getByRole("button", { name: /clear all filters/i }),
    ).toBeVisible();
  });

  test("selecting a category filter shows only matching rows", async ({
    page,
  }) => {
    await page.goto("/tickets");
    await expect(page.getByRole("table")).toBeVisible();

    await page.getByRole("combobox", { name: /filter by category/i }).click();
    await page.getByRole("option", { name: /^technical$/i }).click();

    // Every category cell must say "technical".
    const categoryCells = page
      .getByRole("cell")
      .filter({ hasText: /^technical$/i });
    // Also confirm no cells show "general" or "refund".
    await expect(page.getByRole("cell", { name: /^general$/i })).toHaveCount(0);
    await expect(page.getByRole("cell", { name: /^refund$/i })).toHaveCount(0);
    expect(await categoryCells.count()).toBeGreaterThan(0);
  });

  test("Clear button resets filters and shows all tickets again", async ({
    page,
  }) => {
    await page.goto("/tickets");
    await expect(page.getByRole("table")).toBeVisible();

    // Apply a filter.
    await page.getByRole("combobox", { name: /filter by status/i }).click();
    await page.getByRole("option", { name: /^closed$/i }).click();

    // Confirm filter is active.
    await expect(
      page.getByRole("button", { name: /clear all filters/i }),
    ).toBeVisible();

    // Clear the filter.
    await page.getByRole("button", { name: /clear all filters/i }).click();

    // Clear button should disappear and other status values should return.
    await expect(
      page.getByRole("button", { name: /clear all filters/i }),
    ).not.toBeVisible();
    // At least one "open" badge confirms the full list is back.
    await expect(page.getByRole("cell").filter({ hasText: /^open$/ }).first()).toBeVisible();
  });
});
