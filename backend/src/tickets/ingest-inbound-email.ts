import { z } from "zod";
import { TicketStatus } from "@helpdesk/core";
import { prisma } from "../prisma.ts";
import { normalizeSubject } from "./normalize-subject.ts";
import { sanitizeHtml } from "./sanitize-html.ts";
import { aiAgentId } from "./ai-agent.ts";

// Upper bounds on an inbound email. Deliberately generous: a rejected payload is
// a student's support request that never gets answered, so these exist to stop
// unbounded writes reaching Postgres (every column is `text`), not to police
// etiquette. Where a relevant RFC limit exists, it's used.
const MAX_EMAIL_LENGTH = 255; // RFC 5321 reverse-path limit
const MAX_NAME_LENGTH = 255;
const MAX_SUBJECT_LENGTH = 255;
// Sits well inside express.json()'s 100kb default, which rejects a larger
// payload with 413 before this schema ever runs.
const MAX_BODY_LENGTH = 1_000;
// The same content costs more characters once wrapped in markup, so the HTML
// part gets a multiple of the plain-text cap rather than its own flat number —
// retuning MAX_BODY_LENGTH keeps the two in proportion.
const MAX_BODY_HTML_LENGTH = MAX_BODY_LENGTH * 2;
const MAX_MESSAGE_ID_LENGTH = 998; // RFC 5322 line-length limit
const MAX_REFERENCES = 100;

// The provider-agnostic shape an inbound email is normalized to before it
// becomes a ticket. A future Mailgun webhook adapter maps Mailgun's fields onto
// this. `category` is deliberately absent — it's set later by AI classification.
export const inboundEmailSchema = z.object({
  fromEmail: z.email().trim().max(MAX_EMAIL_LENGTH),
  fromName: z
    .string()
    .trim()
    .min(1, "fromName is required")
    .max(MAX_NAME_LENGTH),
  // Normalize the customer's subject: strip Re:/Fwd: prefixes, collapse
  // whitespace, and fall back to "(no subject)" (also when the field is absent).
  // The cap applies to the raw subject; normalizing only ever shortens it.
  subject: z
    .string()
    .max(MAX_SUBJECT_LENGTH)
    .optional()
    .transform((value) => normalizeSubject(value ?? "")),
  body: z.string().max(MAX_BODY_LENGTH).default(""),
  // The email's text/html part, sanitized at the boundary so what reaches the
  // database is already safe to render — no consumer has to remember to clean it.
  // The cap applies to the raw input; sanitizing only ever shortens. Optional
  // rather than defaulted so a plain-text-only email (or one whose HTML was
  // entirely stripped) leaves the column null instead of recording an empty
  // string as if HTML had been sent.
  bodyHtml: z
    .string()
    .max(MAX_BODY_HTML_LENGTH)
    .transform(sanitizeHtml)
    .optional(),
  messageId: z.string().trim().max(MAX_MESSAGE_ID_LENGTH).optional(),
  inReplyTo: z.string().trim().max(MAX_MESSAGE_ID_LENGTH).optional(),
  // A long thread accumulates references, so the array is bounded too — without
  // it, each id being capped still allows an arbitrarily large `references[]`.
  references: z
    .array(z.string().trim().max(MAX_MESSAGE_ID_LENGTH))
    .max(MAX_REFERENCES)
    .optional(),
});

export type InboundEmailInput = z.infer<typeof inboundEmailSchema>;

export interface IngestResult {
  ticketId: number;
  status: "created" | "threaded" | "deduped";
}

export async function ingestInboundEmail(
  input: InboundEmailInput,
): Promise<IngestResult> {
  const {
    fromEmail,
    fromName,
    subject,
    body,
    bodyHtml,
    messageId,
    inReplyTo,
    references,
  } = input;

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
          bodyHtml,
          messageId,
          inReplyTo,
          references: references ?? [],
        },
      });
      // A reply on a resolved/closed ticket reopens it, and it is no longer
      // resolved, so the time-to-resolve stamp goes with it.
      //
      // The assignment is a separate, narrower statement rather than an
      // `assignedToId: null` in the same data: this path fires for tickets a
      // *human* resolved and still owns, and clearing those would take an
      // agent's own thread away from them. So only the AI's grip is released —
      // an AI-resolved ticket whose answer didn't hold goes to the shared pool,
      // while an agent-resolved one stays with whoever answered it.
      const aiId = await aiAgentId();
      await prisma.$transaction([
        prisma.ticket.updateMany({
          where: { id: parent.ticketId, status: { in: ["resolved", "closed"] } },
          data: { status: "open", resolvedAt: null },
        }),
        ...(aiId
          ? [
              prisma.ticket.updateMany({
                // `status: open` is what limits this to a ticket the statement
                // above just reopened. Without it, a follow-up email arriving
                // while the ticket is still `new`/`processing` would pull the
                // assignment out from under the worker mid-call.
                where: {
                  id: parent.ticketId,
                  assignedToId: aiId,
                  status: "open",
                },
                data: { assignedToId: null },
              }),
            ]
          : []),
      ]);
      return { ticketId: parent.ticketId, status: "threaded" };
    }
  }

  // 3. Otherwise this starts a new ticket with its first inbound message.
  // Arrives as `new` (the auto-resolve worker's claim window) rather than
  // `open` — scheduleTicketAutoResolve (called by the webhook route right
  // after this) assumes exactly that, and only moves it to `open` itself when
  // no worker will ever pick it up.
  // Assigned to the AI agent from the moment it exists, so the ticket never has
  // a status saying the model owns it and an empty assignee saying nobody does.
  // Null when the AI user hasn't been seeded — that just means unassigned, which
  // is exactly how tickets behaved before it existed.
  const assignedToId = await aiAgentId();

  const ticket = await prisma.ticket.create({
    data: {
      subject,
      requesterEmail: fromEmail,
      requesterName: fromName,
      status: TicketStatus.new,
      assignedToId,
      messages: {
        create: {
          direction: "inbound",
          fromEmail,
          fromName,
          body,
          bodyHtml,
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
