import { z } from "zod";
import { prisma } from "../prisma.ts";
import { normalizeSubject } from "./normalize-subject.ts";

// The provider-agnostic shape an inbound email is normalized to before it
// becomes a ticket. A future Mailgun webhook adapter maps Mailgun's fields onto
// this. `category` is deliberately absent — it's set later by AI classification.
export const inboundEmailSchema = z.object({
  fromEmail: z.email().trim(),
  fromName: z.string().trim().min(1, "fromName is required"),
  // Normalize the customer's subject: strip Re:/Fwd: prefixes, collapse
  // whitespace, and fall back to "(no subject)" (also when the field is absent).
  subject: z
    .string()
    .optional()
    .transform((value) => normalizeSubject(value ?? "")),
  body: z.string().default(""),
  messageId: z.string().trim().optional(),
  inReplyTo: z.string().trim().optional(),
  references: z.array(z.string().trim()).optional(),
});

export type InboundEmailInput = z.infer<typeof inboundEmailSchema>;

export interface IngestResult {
  ticketId: number;
  status: "created" | "threaded" | "deduped";
}

export async function ingestInboundEmail(
  input: InboundEmailInput,
): Promise<IngestResult> {
  const { fromEmail, fromName, subject, body, messageId, inReplyTo, references } =
    input;

  // 1. Idempotency — we've already ingested this exact email (a provider retry).
  if (messageId) {
    const existing = await prisma.message.findUnique({
      where: { messageId },
      select: { ticketId: true },
    });
    if (existing) {
      return { ticketId: existing.ticketId, status: "deduped" };
    }
  }

  // 2. Threading — does this reply reference an email we've already stored?
  const candidates = [inReplyTo, ...(references ?? [])].filter(
    (id): id is string => Boolean(id),
  );
  if (candidates.length > 0) {
    const parent = await prisma.message.findFirst({
      where: { messageId: { in: candidates } },
      select: { ticketId: true },
    });
    if (parent) {
      await prisma.message.create({
        data: {
          ticketId: parent.ticketId,
          direction: "inbound",
          fromEmail,
          fromName,
          body,
          messageId,
          inReplyTo,
          references: references ?? [],
        },
      });
      // A reply on a resolved/closed ticket reopens it.
      await prisma.ticket.updateMany({
        where: { id: parent.ticketId, status: { in: ["resolved", "closed"] } },
        data: { status: "open" },
      });
      return { ticketId: parent.ticketId, status: "threaded" };
    }
  }

  // 3. Otherwise this starts a new ticket with its first inbound message.
  const ticket = await prisma.ticket.create({
    data: {
      subject,
      requesterEmail: fromEmail,
      requesterName: fromName,
      status: "open",
      messages: {
        create: {
          direction: "inbound",
          fromEmail,
          fromName,
          body,
          messageId,
          inReplyTo,
          references: references ?? [],
        },
      },
    },
    select: { id: true },
  });
  return { ticketId: ticket.id, status: "created" };
}
