/**
 * Auto-resolve status scoping — exercises the GET /api/tickets `where` clause
 * that hides tickets the auto-resolve worker still owns (`new`/`processing`)
 * from the default list, and the narrowed PATCH schema that keeps agents from
 * setting either owned status by hand.
 *
 * Only the in-flight window is hidden. A ticket the AI resolved is ordinary
 * history and appears in the list exactly like an agent-resolved one — the
 * third case guards that, since an earlier revision wrongly hid it forever.
 *
 * This earns e2e coverage (not a component test) because it depends on real
 * Postgres `where`-clause enforcement (Prisma `notIn`) and a real Zod enum
 * rejection on the server — neither is observable with a mocked network.
 *
 * Cases 1–3 seed ticket rows directly via e2e/helpers/seed-ticket.ts instead
 * of the inbound-email webhook. The test env runs with
 * AUTO_RESOLVE_ENABLED=false (see backend/.env.test), so a webhook-created
 * ticket is synchronously moved from `new` to `open` before the webhook even
 * responds — there is no observable window in which it sits at `new`, and no
 * way to produce a `resolved` + AI-answered ticket at all without a real model
 * call. Direct seeding sidesteps both, and is what backend/.env.test's own
 * comment points to. The webhook's *creation* path (that a fresh ticket really
 * does start at `new` and is only flipped to `open` by
 * scheduleTicketAutoResolve when disabled) is exercised by
 * ticket-detail.spec.ts and tickets.spec.ts, which assert new tickets arrive
 * "open" — not duplicated here.
 *
 * Filter-bar UI behaviour (status dropdown rendering/reset) is covered by
 * frontend/src/pages/TicketsPage.test.tsx against a mocked network; only the
 * server-side scoping and enforcement live here.
 *
 * Test backend: API_BASE_URL from backend/.env.test (default: http://localhost:3101)
 * Admin session: loaded from .auth/admin.json (project-level storageState)
 */

import { test, expect } from "@playwright/test";
import { seedTicket } from "./helpers/seed-ticket.ts";

const BACKEND = process.env.API_BASE_URL;
if (!BACKEND) {
  throw new Error(
    "API_BASE_URL is not set. Ensure playwright.config.ts loads backend/.env.test " +
      "before the Playwright runner starts.",
  );
}
const TICKETS_API = `${BACKEND}/api/tickets`;

// The suffix goes into each seeded subject and is then used as a `search` token
// to scope the list responses, so it has to be unique across parallel workers,
// not just within one. Each worker is a fresh process with its own counter
// starting at zero, so the counter alone collides; the random token separates
// two workers that call this in the same millisecond.
const workerToken = Math.random().toString(36).slice(2, 10);
let counter = 0;
function uniqueSuffix(): string {
  counter += 1;
  return `${Date.now()}-${workerToken}-${counter}`;
}

interface TicketListItem {
  id: number;
  status: string;
}

test.describe("GET /api/tickets — auto-resolve status scoping", () => {
  test("a ticket left at `new` is absent from the default list but present under ?status=new", async ({
    request,
  }) => {
    const suffix = uniqueSuffix();
    const ticketId = seedTicket({
      status: "new",
      aiResolvedAt: false,
      subject: `New-status ticket ${suffix}`,
      requesterEmail: `new-status-${suffix}@example.com`,
      requesterName: "New Status Student",
    });

    // Scoped by the run's own token: on an unscoped list the ticket could be
    // off page 1 for reasons that have nothing to do with the `where` clause,
    // and the absence assertion would pass without proving anything.
    const defaultResp = await request.get(`${TICKETS_API}?search=${suffix}`);
    expect(defaultResp.status()).toBe(200);
    const { tickets: defaultTickets } = (await defaultResp.json()) as {
      tickets: TicketListItem[];
    };
    expect(defaultTickets.some((t) => t.id === ticketId)).toBe(false);

    const newResp = await request.get(`${TICKETS_API}?status=new&search=${suffix}`);
    expect(newResp.status()).toBe(200);
    const { tickets: newTickets } = (await newResp.json()) as {
      tickets: TicketListItem[];
    };
    const found = newTickets.find((t) => t.id === ticketId);
    expect(found).toBeDefined();
    expect(found?.status).toBe("new");
  });

  // Who answered it makes no difference once the worker is finished: both rows
  // are `resolved` and both belong in the list. Run as one case per answerer so
  // a regression that re-hides the AI's work names itself in the failure.
  for (const answeredByAi of [true, false] as const) {
    const label = answeredByAi ? "AI-resolved" : "agent-resolved";

    test(`a ${label} ticket is present in the default list`, async ({
      request,
    }) => {
      const suffix = uniqueSuffix();
      const ticketId = seedTicket({
        status: "resolved",
        aiResolvedAt: answeredByAi,
        subject: `${label} ticket ${suffix}`,
        requesterEmail: `${label}-${suffix}@example.com`,
        requesterName: "Resolved Student",
      });

      // No status param — the default scope is what's under test. `search` only
      // narrows to this run's row so a busy list can't page it out of sight.
      const defaultResp = await request.get(`${TICKETS_API}?search=${suffix}`);
      expect(defaultResp.status()).toBe(200);
      const { tickets: defaultTickets } = (await defaultResp.json()) as {
        tickets: TicketListItem[];
      };
      const found = defaultTickets.find((t) => t.id === ticketId);
      expect(found).toBeDefined();
      expect(found?.status).toBe("resolved");
    });
  }
});

test.describe("PATCH /api/tickets/:id — status narrowed to agentTicketStatuses", () => {
  for (const status of ["new", "processing"] as const) {
    test(`rejects status: "${status}" with 400`, async ({ request }) => {
      const suffix = uniqueSuffix();
      const ticketId = seedTicket({
        status: "open",
        aiResolvedAt: false,
        subject: `Patch guard ticket ${suffix} ${status}`,
        requesterEmail: `patch-guard-${status}-${suffix}@example.com`,
        requesterName: "Patch Guard Student",
      });

      const resp = await request.patch(`${TICKETS_API}/${ticketId}`, {
        data: { status },
      });
      expect(resp.status()).toBe(400);
      const body = (await resp.json()) as { error: unknown };
      expect(body.error).toBeDefined();

      // Confirm the rejection didn't partially apply — status is unchanged.
      const getResp = await request.get(`${TICKETS_API}/${ticketId}`);
      const { ticket } = (await getResp.json()) as { ticket: { status: string } };
      expect(ticket.status).toBe("open");
    });
  }
});
