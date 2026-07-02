/**
 * Inbound-email webhook e2e tests — exercises POST /api/webhooks/inbound-email.
 *
 * The endpoint is NOT session-authenticated. It uses a shared secret header
 * (X-Inbound-Secret) for auth, so every test uses an isolated request context
 * with no storageState (no browser cookies at all).
 *
 * Test backend: API_BASE_URL from backend/.env.test (default: http://localhost:3101)
 * Secret: INBOUND_EMAIL_SECRET from backend/.env.test
 *
 * IMPORTANT: messageId values must be globally unique within a container session
 * because the test DB persists across reruns until the container is stopped.
 * Every test that creates messages uses Date.now() plus a per-invocation counter
 * to prevent inter-run collisions.
 *
 * NOTE: "reopen on reply to resolved/closed ticket" IS implemented in the backend
 * (ingest-inbound-email.ts calls updateMany to reopen), but cannot be asserted
 * here because there is no ticket-read API yet. Add that assertion once
 * GET /api/tickets/:id is available.
 */

import { test, expect } from "@playwright/test";

// These vars are loaded from backend/.env.test by playwright.config.ts before
// the runner starts. Missing values mean the env file was not loaded correctly —
// fail loudly rather than producing confusing 401s or connection-refused errors.
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

// Monotonically increasing counter to ensure uniqueness even when multiple
// tests in the same process generate messageIds in the same millisecond.
let counter = 0;
function uniqueSuffix(): string {
  counter += 1;
  return `${Date.now()}-${counter}`;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

test.describe("Inbound-email webhook — auth", () => {
  test("missing X-Inbound-Secret header → 401", async ({ playwright }) => {
    const req = await playwright.request.newContext({
      storageState: { cookies: [], origins: [] },
    });

    const response = await req.post(WEBHOOK, {
      data: {
        fromEmail: "student@example.com",
        fromName: "Student",
        subject: "Help",
        body: "I need help.",
      },
    });

    expect(response.status()).toBe(401);
    const body = await response.json() as { error: string };
    expect(body.error).toBe("Unauthorized");

    await req.dispose();
  });

  test("wrong X-Inbound-Secret header → 401", async ({ playwright }) => {
    const req = await playwright.request.newContext({
      storageState: { cookies: [], origins: [] },
    });

    const response = await req.post(WEBHOOK, {
      headers: { "x-inbound-secret": "totally-wrong-secret" },
      data: {
        fromEmail: "student@example.com",
        fromName: "Student",
        subject: "Help",
        body: "I need help.",
      },
    });

    expect(response.status()).toBe(401);
    const body = await response.json() as { error: string };
    expect(body.error).toBe("Unauthorized");

    await req.dispose();
  });
});

// ─── Validation ───────────────────────────────────────────────────────────────

test.describe("Inbound-email webhook — Zod validation", () => {
  test("missing fromName → 400", async ({ playwright }) => {
    const req = await playwright.request.newContext({
      storageState: { cookies: [], origins: [] },
    });

    const response = await req.post(WEBHOOK, {
      headers: { "x-inbound-secret": SECRET },
      data: {
        fromEmail: "student@example.com",
        // fromName intentionally omitted
        subject: "Help",
        body: "I need help.",
      },
    });

    expect(response.status()).toBe(400);
    const body = await response.json() as { error: unknown };
    expect(body.error).toBeDefined();

    await req.dispose();
  });

  test("invalid fromEmail → 400", async ({ playwright }) => {
    const req = await playwright.request.newContext({
      storageState: { cookies: [], origins: [] },
    });

    const response = await req.post(WEBHOOK, {
      headers: { "x-inbound-secret": SECRET },
      data: {
        fromEmail: "not-an-email",
        fromName: "Student",
        subject: "Help",
        body: "I need help.",
      },
    });

    expect(response.status()).toBe(400);
    const body = await response.json() as { error: unknown };
    expect(body.error).toBeDefined();

    await req.dispose();
  });

  test("empty fromName after trim → 400", async ({ playwright }) => {
    const req = await playwright.request.newContext({
      storageState: { cookies: [], origins: [] },
    });

    const response = await req.post(WEBHOOK, {
      headers: { "x-inbound-secret": SECRET },
      data: {
        fromEmail: "student@example.com",
        fromName: "   ", // trims to empty string — Zod min(1) rejects it
        subject: "Help",
        body: "I need help.",
      },
    });

    expect(response.status()).toBe(400);
    const body = await response.json() as { error: unknown };
    expect(body.error).toBeDefined();

    await req.dispose();
  });
});

// ─── Create ───────────────────────────────────────────────────────────────────

test.describe("Inbound-email webhook — create new ticket", () => {
  test("valid email with fresh messageId → 201, status created, numeric ticketId", async ({
    playwright,
  }) => {
    const req = await playwright.request.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const suffix = uniqueSuffix();

    const response = await req.post(WEBHOOK, {
      headers: { "x-inbound-secret": SECRET },
      data: {
        fromEmail: `student-${suffix}@example.com`,
        fromName: "Test Student",
        subject: "My first ticket",
        body: "Hello, I need some help.",
        messageId: `<create-${suffix}@mail.example.com>`,
      },
    });

    expect(response.status()).toBe(201);
    const body = await response.json() as { ticketId: number; status: string };
    expect(body.status).toBe("created");
    expect(typeof body.ticketId).toBe("number");

    await req.dispose();
  });

  test("omitting optional subject still creates ticket → 201", async ({
    playwright,
  }) => {
    const req = await playwright.request.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const suffix = uniqueSuffix();

    const response = await req.post(WEBHOOK, {
      headers: { "x-inbound-secret": SECRET },
      data: {
        fromEmail: `student-${suffix}@example.com`,
        fromName: "Test Student",
        // subject intentionally omitted — backend defaults to "(no subject)"
        body: "No subject email.",
        messageId: `<no-subject-${suffix}@mail.example.com>`,
      },
    });

    expect(response.status()).toBe(201);
    const body = await response.json() as { ticketId: number; status: string };
    expect(body.status).toBe("created");
    expect(typeof body.ticketId).toBe("number");

    await req.dispose();
  });
});

// ─── Threading ────────────────────────────────────────────────────────────────

test.describe("Inbound-email webhook — threading", () => {
  test("reply via inReplyTo threads onto the original ticket", async ({
    playwright,
  }) => {
    const req = await playwright.request.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const suffix = uniqueSuffix();
    const originalMessageId = `<thread-original-${suffix}@mail.example.com>`;
    const replyMessageId = `<thread-reply-${suffix}@mail.example.com>`;

    // Post the original email — creates a new ticket.
    const createResponse = await req.post(WEBHOOK, {
      headers: { "x-inbound-secret": SECRET },
      data: {
        fromEmail: `thread-student-${suffix}@example.com`,
        fromName: "Thread Student",
        subject: "Original question",
        body: "I have a question.",
        messageId: originalMessageId,
      },
    });
    expect(createResponse.status()).toBe(201);
    const { ticketId: originalTicketId } = await createResponse.json() as {
      ticketId: number;
      status: string;
    };

    // Post a reply referencing the original via inReplyTo.
    const replyResponse = await req.post(WEBHOOK, {
      headers: { "x-inbound-secret": SECRET },
      data: {
        fromEmail: `thread-student-${suffix}@example.com`,
        fromName: "Thread Student",
        subject: "Re: Original question",
        body: "Actually I have a follow-up.",
        messageId: replyMessageId,
        inReplyTo: originalMessageId,
      },
    });

    expect(replyResponse.status()).toBe(200);
    const replyBody = await replyResponse.json() as { ticketId: number; status: string };
    expect(replyBody.status).toBe("threaded");
    // Reply must land on the same ticket as the original message.
    expect(replyBody.ticketId).toBe(originalTicketId);

    await req.dispose();
  });

  test("reply via references array threads onto the original ticket", async ({
    playwright,
  }) => {
    const req = await playwright.request.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const suffix = uniqueSuffix();
    const originalMessageId = `<refs-original-${suffix}@mail.example.com>`;
    const replyMessageId = `<refs-reply-${suffix}@mail.example.com>`;

    const createResponse = await req.post(WEBHOOK, {
      headers: { "x-inbound-secret": SECRET },
      data: {
        fromEmail: `refs-student-${suffix}@example.com`,
        fromName: "Refs Student",
        subject: "Original via refs",
        body: "First message.",
        messageId: originalMessageId,
      },
    });
    expect(createResponse.status()).toBe(201);
    const { ticketId: originalTicketId } = await createResponse.json() as {
      ticketId: number;
      status: string;
    };

    // Post a reply referencing the original via the references array, not inReplyTo.
    const replyResponse = await req.post(WEBHOOK, {
      headers: { "x-inbound-secret": SECRET },
      data: {
        fromEmail: `refs-student-${suffix}@example.com`,
        fromName: "Refs Student",
        subject: "Re: Original via refs",
        body: "Follow-up via references.",
        messageId: replyMessageId,
        references: [originalMessageId],
      },
    });

    expect(replyResponse.status()).toBe(200);
    const replyBody = await replyResponse.json() as { ticketId: number; status: string };
    expect(replyBody.status).toBe("threaded");
    expect(replyBody.ticketId).toBe(originalTicketId);

    await req.dispose();
  });
});

// ─── Idempotency ──────────────────────────────────────────────────────────────

test.describe("Inbound-email webhook — idempotency", () => {
  test("re-posting the same messageId → 200, status deduped, same ticketId", async ({
    playwright,
  }) => {
    const req = await playwright.request.newContext({
      storageState: { cookies: [], origins: [] },
    });
    const suffix = uniqueSuffix();
    const messageId = `<dedup-${suffix}@mail.example.com>`;
    const payload = {
      fromEmail: `dedup-student-${suffix}@example.com`,
      fromName: "Dedup Student",
      subject: "Duplicate email",
      body: "This will be sent twice.",
      messageId,
    };

    // First POST — creates the ticket.
    const firstResponse = await req.post(WEBHOOK, {
      headers: { "x-inbound-secret": SECRET },
      data: payload,
    });
    expect(firstResponse.status()).toBe(201);
    const { ticketId: originalTicketId } = await firstResponse.json() as {
      ticketId: number;
      status: string;
    };

    // Second POST with identical messageId — must be deduped, not created again.
    const secondResponse = await req.post(WEBHOOK, {
      headers: { "x-inbound-secret": SECRET },
      data: payload,
    });
    expect(secondResponse.status()).toBe(200);
    const dedupBody = await secondResponse.json() as { ticketId: number; status: string };
    expect(dedupBody.status).toBe("deduped");
    expect(dedupBody.ticketId).toBe(originalTicketId);

    await req.dispose();
  });
});
