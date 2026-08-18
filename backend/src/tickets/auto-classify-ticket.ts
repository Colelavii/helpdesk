import { prisma } from "../prisma.ts";
import {
  classifyTicket,
  MissingClassificationApiKeyError,
} from "./classify-ticket.ts";
import type { IngestResult } from "./ingest-inbound-email.ts";

export interface AutoClassifyResult {
  status: "classified" | "skipped" | "superseded";
}

// Classify a ticket from its subject and first inbound message, then store the
// result on the ticket. Intended for tickets created by the inbound-email
// webhook, which leaves `category` unset.
export async function autoClassifyTicket(
  ticketId: number,
): Promise<AutoClassifyResult> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: {
      subject: true,
      category: true,
      messages: {
        where: { direction: "inbound" },
        select: { body: true },
        orderBy: { createdAt: "asc" },
        take: 1,
      },
    },
  });

  // Already categorised (or gone) — nothing to decide.
  if (!ticket || ticket.category !== null) return { status: "skipped" };

  const category = await classifyTicket({
    subject: ticket.subject,
    body: ticket.messages[0]?.body ?? "",
  });

  // updateMany, not update: the `category: null` filter means an agent who set
  // the category by hand while the model was still running keeps their choice.
  const { count } = await prisma.ticket.updateMany({
    where: { id: ticketId, category: null },
    data: { category },
  });

  return { status: count === 1 ? "classified" : "superseded" };
}

// Fire-and-forget entry point, taking an ingest result straight from the
// inbound-email webhook so the decision of which results are worth classifying
// lives here rather than at the call site. The webhook has to acknowledge the
// provider straight away, so classification must not hold up — or fail — that
// response: the ticket is already stored, and an uncategorised ticket is a
// dropdown an agent can still set themselves.
export function classifyTicketInBackground(result: IngestResult): void {
  // Only a brand-new ticket needs a category. A reply threaded onto an existing
  // ticket keeps that ticket's category, and a deduped provider retry has
  // already been handled by the delivery it duplicates.
  if (result.status !== "created") return;

  const { ticketId } = result;
  void autoClassifyTicket(ticketId).catch((error: unknown) => {
    if (error instanceof MissingClassificationApiKeyError) {
      console.warn(
        `Skipping classification for ticket ${ticketId}: ANTHROPIC_API_KEY is not configured`,
      );
      return;
    }
    console.error(`Failed to classify ticket ${ticketId}`, error);
  });
}
