/**
 * Ticket detail e2e tests — exercises GET/PATCH /api/tickets/:id, POST
 * /api/tickets/:id/messages, and the /tickets/:id UI.
 *
 * Ticket list behaviour (GET /api/tickets shape/sort/filter, PATCH assignment,
 * /tickets page UI) is covered by e2e/tickets.spec.ts — not duplicated here.
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

import { test, expect, type APIRequestContext, type Page } from "@playwright/test";

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
// The signed-in project storageState is the seeded admin (see auth-test-harness
// memory) — used to assert reply-message attribution.
const ADMIN_EMAIL = process.env.ADMIN_EMAIL;
if (!ADMIN_EMAIL) {
  throw new Error(
    "ADMIN_EMAIL is not set. Ensure playwright.config.ts loads backend/.env.test " +
      "before the Playwright runner starts.",
  );
}
// Matches the literal name Better Auth seeds the admin with in backend/src/seed.ts.
const ADMIN_NAME = "Admin";

const WEBHOOK = `${BACKEND}/api/webhooks/inbound-email`;
const TICKETS_API = `${BACKEND}/api/tickets`;

// Monotonically increasing counter plus a random component ensures uniqueness
// even when multiple calls land in the same millisecond — which happens often
// under full parallelism, since each worker process starts its own counter at
// 0 and several workers can call this within the same millisecond.
let counter = 0;
function uniqueSuffix(): string {
  counter += 1;
  return `${Date.now()}-${counter}-${Math.random().toString(36).slice(2, 8)}`;
}

interface SeededTicket {
  ticketId: number;
  subject: string;
  fromEmail: string;
  fromName: string;
  body: string;
}

// Seeds a fresh ticket (one inbound message) via the inbound-email webhook.
// New tickets always start as status "open" with no category and no assignee
// (see ingest-inbound-email.ts) — no synchronous AI classification runs, so
// these defaults are deterministic for tests.
async function seedTicket(request: APIRequestContext): Promise<SeededTicket> {
  const suffix = uniqueSuffix();
  const subject = `Ticket detail test ${suffix}`;
  const fromEmail = `detail-student-${suffix}@example.com`;
  const fromName = "Detail Student";
  const body = `Original inbound message body ${suffix}.`;

  const res = await request.post(WEBHOOK, {
    headers: { "x-inbound-secret": SECRET! },
    data: {
      fromEmail,
      fromName,
      subject,
      body,
      messageId: `<detail-${suffix}@mail.example.com>`,
    },
  });
  expect(res.status()).toBe(201);
  const { ticketId } = (await res.json()) as { ticketId: number; status: string };

  return { ticketId, subject, fromEmail, fromName, body };
}

// Locates the message Card in the thread containing the given body text.
function messageCard(page: Page, body: string) {
  return page.locator('[data-slot="card"]').filter({ hasText: body });
}

// ─── API: GET /api/tickets/:id ────────────────────────────────────────────────

test.describe("GET /api/tickets/:id", () => {
  test("returns 401 with no session cookie", async ({ playwright, request }) => {
    const { ticketId } = await seedTicket(request);

    const isolated = await playwright.request.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const resp = await isolated.get(`${TICKETS_API}/${ticketId}`);
    expect(resp.status()).toBe(401);

    await isolated.dispose();
  });

  test("returns the full ticket shape with assignedTo null and one inbound message", async ({
    request,
  }) => {
    const seeded = await seedTicket(request);

    const resp = await request.get(`${TICKETS_API}/${seeded.ticketId}`);
    expect(resp.status()).toBe(200);
    const { ticket } = (await resp.json()) as {
      ticket: {
        id: number;
        subject: string;
        requesterEmail: string;
        requesterName: string;
        status: string;
        category: string | null;
        assignedTo: { id: string; name: string; email: string } | null;
        messages: Array<{
          id: number;
          direction: string;
          fromEmail: string;
          fromName: string;
          body: string;
          createdAt: string;
        }>;
      };
    };

    expect(ticket.id).toBe(seeded.ticketId);
    expect(ticket.subject).toBe(seeded.subject);
    expect(ticket.requesterEmail).toBe(seeded.fromEmail);
    expect(ticket.requesterName).toBe(seeded.fromName);
    expect(ticket.status).toBe("open");
    expect(ticket.category).toBeNull();
    expect(ticket.assignedTo).toBeNull();

    expect(ticket.messages).toHaveLength(1);
    expect(ticket.messages[0].direction).toBe("inbound");
    expect(ticket.messages[0].fromEmail).toBe(seeded.fromEmail);
    expect(ticket.messages[0].body).toBe(seeded.body);
  });

  test("messages array is ordered oldest-first once a reply is added", async ({
    request,
  }) => {
    const seeded = await seedTicket(request);

    const replyBody = `Agent reply ${uniqueSuffix()}`;
    const replyRes = await request.post(
      `${TICKETS_API}/${seeded.ticketId}/messages`,
      { data: { body: replyBody } },
    );
    expect(replyRes.status()).toBe(201);

    const resp = await request.get(`${TICKETS_API}/${seeded.ticketId}`);
    expect(resp.status()).toBe(200);
    const { ticket } = (await resp.json()) as {
      ticket: { messages: Array<{ direction: string; body: string }> };
    };

    expect(ticket.messages).toHaveLength(2);
    // Oldest first: the original inbound message, then the outbound reply.
    expect(ticket.messages[0].direction).toBe("inbound");
    expect(ticket.messages[0].body).toBe(seeded.body);
    expect(ticket.messages[1].direction).toBe("outbound");
    expect(ticket.messages[1].body).toBe(replyBody);
  });

  test("returns 404 for an unknown ticket id", async ({ request }) => {
    const resp = await request.get(`${TICKETS_API}/99999999`);
    expect(resp.status()).toBe(404);
    const body = (await resp.json()) as { error: string };
    expect(body.error).toBe("Ticket not found");
  });

  test("returns 404 for a non-integer id (parseId guard)", async ({
    request,
  }) => {
    const resp = await request.get(`${TICKETS_API}/abc`);
    expect(resp.status()).toBe(404);
    const body = (await resp.json()) as { error: string };
    expect(body.error).toBe("Ticket not found");
  });
});

// ─── API: POST /api/tickets/:id/messages ──────────────────────────────────────

test.describe("POST /api/tickets/:id/messages", () => {
  test("requires authentication (no session cookie) → 401", async ({
    playwright,
    request,
  }) => {
    const { ticketId } = await seedTicket(request);

    const isolated = await playwright.request.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const resp = await isolated.post(`${TICKETS_API}/${ticketId}/messages`, {
      data: { body: "Should not be allowed." },
    });
    expect(resp.status()).toBe(401);

    await isolated.dispose();
  });

  test("creates an outbound message attributed to the signed-in agent, with a trimmed body", async ({
    request,
  }) => {
    const { ticketId } = await seedTicket(request);
    const rawBody = `  Reply with padding ${uniqueSuffix()}  `;

    const resp = await request.post(`${TICKETS_API}/${ticketId}/messages`, {
      data: { body: rawBody },
    });
    expect(resp.status()).toBe(201);
    const { message } = (await resp.json()) as {
      message: {
        id: number;
        direction: string;
        fromEmail: string;
        fromName: string;
        body: string;
      };
    };

    expect(message.direction).toBe("outbound");
    expect(message.fromEmail).toBe(ADMIN_EMAIL);
    expect(message.fromName).toBe(ADMIN_NAME);
    expect(message.body).toBe(rawBody.trim());

    // Persisted and visible through the detail endpoint too.
    const getResp = await request.get(`${TICKETS_API}/${ticketId}`);
    const { ticket } = (await getResp.json()) as {
      ticket: { messages: Array<{ id: number; body: string }> };
    };
    expect(ticket.messages.some((m) => m.id === message.id && m.body === rawBody.trim())).toBe(
      true,
    );
  });

  test("rejects an empty or whitespace-only body with 400", async ({
    request,
  }) => {
    const { ticketId } = await seedTicket(request);

    for (const body of ["", "   ", "\n\t"]) {
      const resp = await request.post(`${TICKETS_API}/${ticketId}/messages`, {
        data: { body },
      });
      expect(resp.status()).toBe(400);
      const responseBody = (await resp.json()) as { error: unknown };
      expect(responseBody.error).toBeDefined();
    }
  });

  test("returns 404 for an unknown ticket id", async ({ request }) => {
    const resp = await request.post(`${TICKETS_API}/99999999/messages`, {
      data: { body: "Reply to a ticket that doesn't exist." },
    });
    expect(resp.status()).toBe(404);
    const body = (await resp.json()) as { error: string };
    expect(body.error).toBe("Ticket not found");
  });
});

// ─── API: PATCH /api/tickets/:id — status and category ───────────────────────
// (Assignment is covered in e2e/tickets.spec.ts.)

test.describe("PATCH /api/tickets/:id — status and category", () => {
  test("updates the status and it persists across a subsequent GET", async ({
    request,
  }) => {
    const { ticketId } = await seedTicket(request);

    const patchResp = await request.patch(`${TICKETS_API}/${ticketId}`, {
      data: { status: "resolved" },
    });
    expect(patchResp.status()).toBe(200);
    const { ticket: patched } = (await patchResp.json()) as {
      ticket: { status: string };
    };
    expect(patched.status).toBe("resolved");

    const getResp = await request.get(`${TICKETS_API}/${ticketId}`);
    const { ticket } = (await getResp.json()) as { ticket: { status: string } };
    expect(ticket.status).toBe("resolved");
  });

  test("updates the category and it persists, then clears with null", async ({
    request,
  }) => {
    const { ticketId } = await seedTicket(request);

    const setResp = await request.patch(`${TICKETS_API}/${ticketId}`, {
      data: { category: "technical" },
    });
    expect(setResp.status()).toBe(200);
    const { ticket: setTicket } = (await setResp.json()) as {
      ticket: { category: string | null };
    };
    expect(setTicket.category).toBe("technical");

    const getResp = await request.get(`${TICKETS_API}/${ticketId}`);
    const { ticket: fetched } = (await getResp.json()) as {
      ticket: { category: string | null };
    };
    expect(fetched.category).toBe("technical");

    const clearResp = await request.patch(`${TICKETS_API}/${ticketId}`, {
      data: { category: null },
    });
    expect(clearResp.status()).toBe(200);
    const { ticket: clearedTicket } = (await clearResp.json()) as {
      ticket: { category: string | null };
    };
    expect(clearedTicket.category).toBeNull();
  });

  test("rejects an invalid status with 400", async ({ request }) => {
    const { ticketId } = await seedTicket(request);

    const resp = await request.patch(`${TICKETS_API}/${ticketId}`, {
      data: { status: "pending" },
    });
    expect(resp.status()).toBe(400);
    const body = (await resp.json()) as { error: unknown };
    expect(body.error).toBeDefined();
  });

  test("rejects an invalid category with 400", async ({ request }) => {
    const { ticketId } = await seedTicket(request);

    const resp = await request.patch(`${TICKETS_API}/${ticketId}`, {
      data: { category: "billing" },
    });
    expect(resp.status()).toBe(400);
    const body = (await resp.json()) as { error: unknown };
    expect(body.error).toBeDefined();
  });
});

// ─── UI: /tickets/:id page ─────────────────────────────────────────────────────

test.describe("/tickets/:id page — UI", () => {
  // Only paths that need the real stack live here. Rendering the header and the
  // thread, the reply form's validation, the 404 copy, and the loading skeleton
  // are covered against a mocked network by TicketDetailPage.test.tsx,
  // TicketDetail.test.tsx, MessageThread.test.tsx, and ReplyForm.test.tsx.

  test("submitting a reply appends the new outbound message without a manual reload", async ({
    page,
    request,
  }) => {
    const seeded = await seedTicket(request);
    const replyText = `UI reply message ${uniqueSuffix()}`;

    await page.goto(`/tickets/${seeded.ticketId}`);
    await expect(messageCard(page, seeded.body)).toBeVisible();

    await page.getByRole("textbox", { name: "Reply message" }).fill(replyText);
    await page.getByRole("button", { name: "Send reply" }).click();

    const replyCard = messageCard(page, replyText);
    await expect(replyCard).toBeVisible();
    await expect(replyCard.getByText("outbound", { exact: true })).toBeVisible();
    await expect(replyCard.getByText(ADMIN_NAME, { exact: true })).toBeVisible();

    // The textarea clears on success — confirms the mutation path (not a
    // page navigation) produced the update.
    await expect(
      page.getByRole("textbox", { name: "Reply message" }),
    ).toHaveValue("");
  });

  test("changing the status via the Ticket status select persists across a reload", async ({
    page,
    request,
  }) => {
    const seeded = await seedTicket(request);

    await page.goto(`/tickets/${seeded.ticketId}`);

    const statusSelect = page.getByRole("combobox", { name: "Ticket status" });
    await expect(statusSelect).toHaveText("open");

    await statusSelect.click();
    await page.getByRole("option", { name: "resolved" }).click();
    await expect(statusSelect).toHaveText("resolved");

    await page.reload();
    await expect(
      page.getByRole("combobox", { name: "Ticket status" }),
    ).toHaveText("resolved");
  });
});
