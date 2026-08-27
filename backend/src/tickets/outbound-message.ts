import { randomUUID } from "node:crypto";
import { prisma } from "../prisma.ts";
import { supportIdentity } from "./support-identity.ts";
import { inboundEmailLimits } from "./ingest-inbound-email.ts";

// We mint the Message-Id ourselves rather than adopting the one Postmark
// returns, for two reasons: the send API hands back its own delivery UUID and
// not an RFC Message-Id at all, and the id has to exist *before* the send so it
// can be stored on the row and travel in the outbound headers.
//
// Stored bare, without the angle brackets, matching how inboundEmailSchema
// normalizes every id it receives — threading compares the two directly.
export function newOutboundMessageId(): string {
  // RFC 5322 expects the right-hand side to be a domain the sender owns, so it
  // is taken from the support address rather than invented.
  const domain = supportIdentity().email.split("@")[1] ?? "helpdesk.local";
  return `${randomUUID()}@${domain}`;
}

export interface ReplyThreadHeaders {
  inReplyTo?: string;
  references: string[];
}

/**
 * Builds the In-Reply-To / References pair for a reply on a ticket, continuing
 * the chain from the most recent message that has a Message-Id.
 *
 * This is what makes a student's reply land back on the same ticket. Note that
 * it works even when Postmark rewrites our own Message-Id (it does so unless
 * X-PM-KeepID is honoured): the References we send include the ids of *their*
 * earlier messages, their client echoes that chain back, and
 * `ingestInboundEmail` matches on any id in it.
 */
export async function replyThreadHeaders(
  ticketId: number,
): Promise<ReplyThreadHeaders> {
  const parent = await prisma.message.findFirst({
    where: { ticketId, messageId: { not: null } },
    orderBy: { createdAt: "desc" },
    select: { messageId: true, references: true },
  });

  if (!parent?.messageId) return { references: [] };

  // RFC 5322: References is the parent's own References plus the parent's id.
  // Deduplicated because a malformed chain that already names the parent would
  // otherwise grow a repeat on every exchange.
  const chain = [...new Set([...parent.references, parent.messageId])];

  return {
    inReplyTo: parent.messageId,
    // The same bound the inbound side applies, and for the same reason: a long
    // thread would otherwise accumulate an unbounded header. Oldest ids go
    // first, so the nearest ancestors are the ones that survive.
    references: chain.slice(-inboundEmailLimits.references),
  };
}
