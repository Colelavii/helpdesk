import { prisma } from "../prisma.ts";
import { classifyTicket } from "./classify-ticket.ts";

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
