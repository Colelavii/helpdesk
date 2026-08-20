/**
 * Test-only helper script: creates a ticket row directly via Prisma, bypassing
 * the inbound-email webhook and the auto-resolve queue entirely. Called by the
 * Playwright helper as a Bun child process (same pattern as
 * provision-test-agent.ts) so e2e specs never import backend source directly.
 *
 * Usage:
 *   bun --env-file=.env.test run src/seed-test-ticket.ts <status> <aiResolvedAt:true|false> <subject> <requesterEmail> <requesterName>
 *
 * Why direct seeding instead of the webhook: the test env runs with
 * AUTO_RESOLVE_ENABLED=false (see backend/.env.test), so a webhook-created
 * ticket is claimed and synchronously flipped from `new` to `open` by
 * scheduleTicketAutoResolve before the webhook even responds — there is no
 * window in which it observably sits at `new`. Seeding this row directly is
 * the only way to deterministically produce a ticket at an arbitrary status /
 * aiResolvedAt combination for testing the GET /api/tickets `where`-clause
 * scoping, without racing a background worker.
 *
 * Prints `SEEDED_TICKET {"id": <ticketId>}` on its own stdout line. The prefix
 * matters: the shared Prisma client logs every query to stdout outside
 * production (see src/prisma.ts), so the caller has to pick its line out of
 * that noise rather than parsing the whole stream.
 */

import { TicketStatus, type TicketStatus as TicketStatusType } from "@helpdesk/core";
import { prisma } from "./prisma.ts";

const [statusArg, aiResolvedAtArg, subject, requesterEmail, requesterName] =
  process.argv.slice(2);

if (!statusArg || !aiResolvedAtArg || !subject || !requesterEmail || !requesterName) {
  console.error(
    "Usage: seed-test-ticket.ts <status> <aiResolvedAt:true|false> <subject> <requesterEmail> <requesterName>",
  );
  process.exit(1);
}

const validStatuses = Object.values(TicketStatus);
if (!validStatuses.includes(statusArg as TicketStatusType)) {
  console.error(`Invalid status "${statusArg}". Expected one of: ${validStatuses.join(", ")}`);
  process.exit(1);
}
const status = statusArg as TicketStatusType;

if (aiResolvedAtArg !== "true" && aiResolvedAtArg !== "false") {
  console.error(`Invalid aiResolvedAt flag "${aiResolvedAtArg}". Expected "true" or "false"`);
  process.exit(1);
}

const ticket = await prisma.ticket.create({
  data: {
    subject,
    requesterEmail,
    requesterName,
    status,
    aiResolvedAt: aiResolvedAtArg === "true" ? new Date() : null,
    messages: {
      create: {
        direction: "inbound",
        fromEmail: requesterEmail,
        fromName: requesterName,
        body: "Seeded directly for e2e — no real inbound email.",
      },
    },
  },
  select: { id: true },
});

// Keep this prefix in sync with e2e/helpers/seed-ticket.ts, which greps for it.
console.log(`SEEDED_TICKET ${JSON.stringify({ id: ticket.id })}`);
process.exit(0);
