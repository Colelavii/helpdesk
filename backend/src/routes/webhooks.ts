import express, { Router, type Request, type Response } from "express";
import { requireInboundSecret } from "../require-inbound-secret.ts";
import { parseBody } from "../parse-body.ts";
import {
  inboundEmailSchema,
  ingestInboundEmail,
  type IngestResult,
} from "../tickets/ingest-inbound-email.ts";
import {
  postmarkInboundSchema,
  postmarkToInboundEmail,
} from "../tickets/postmark-inbound.ts";
import { enqueueTicketClassification } from "../tickets/classification-queue.ts";
import { scheduleTicketAutoResolve } from "../tickets/auto-resolve-queue.ts";

export const webhooksRouter = Router();

// This router parses its own bodies, because it is mounted ahead of the app-wide
// express.json() (see index.ts): a Postmark payload carries the full HTML part
// plus base64 attachments and routinely exceeds the 100kb default, which would
// 413 the email before any handler saw it. Our own contract keeps the default —
// its fields are capped in the low thousands of characters.
const jsonLimit = process.env.INBOUND_EMAIL_MAX_SIZE ?? "10mb";

// Provider-agnostic inbound-email webhook: turns a received email into a ticket
// (threading replies onto the existing ticket). Guarded by a shared secret. The
// Postmark route below maps its payload onto this same contract.
webhooksRouter.post(
  "/inbound-email",
  requireInboundSecret,
  express.json(),
  async (req: Request, res: Response) => {
    const data = parseBody(inboundEmailSchema, req.body, res);
    if (!data) return;
    const result = await ingestInboundEmail(data);
    await scheduleFollowUpWork(result);

    res.status(result.status === "created" ? 201 : 200).json(result);
  },
);

// Postmark's inbound webhook. Point an inbound server or forwarding address at
// this URL with the shared secret in it — see backend/.env.example.
webhooksRouter.post(
  "/postmark/inbound",
  requireInboundSecret,
  express.json({ limit: jsonLimit }),
  async (req: Request, res: Response) => {
    const payload = parseBody(postmarkInboundSchema, req.body, res);
    if (!payload) return;

    // Two-stage validation: the first parse establishes we were handed a
    // Postmark payload, the adapter maps it onto our contract (clipping it to
    // the contract's caps), and this parse applies the contract's own rules —
    // subject normalization, HTML sanitizing, Message-Id canonicalization.
    const data = parseBody(
      inboundEmailSchema,
      postmarkToInboundEmail(payload),
      res,
    );
    if (!data) return;

    const result = await ingestInboundEmail(data);
    await scheduleFollowUpWork(result);

    // Always 200, never 201: Postmark's contract is a 200 for an accepted
    // webhook, and it retries anything else for up to six hours — a created
    // ticket answering 201 would be delivered again and again.
    res.status(200).json(result);
  },
);

// Enqueued before the acknowledgement so the hand-off is durable: once the
// provider is told we have the email, the background work is already recorded
// and survives a crash or deploy. Both are local inserts, so they cost the
// response nothing like a model call would.
async function scheduleFollowUpWork(result: IngestResult): Promise<void> {
  // A queue that is down must still not fail the delivery — the ticket is
  // stored, and an uncategorised ticket is a dropdown an agent can set — hence
  // the catch.
  await enqueueTicketClassification(result).catch((error: unknown) => {
    console.error(
      `Failed to enqueue classification for ticket ${result.ticketId}`,
      error,
    );
  });

  // Same reasoning, but this one handles its own failures: a new ticket is
  // created hidden from the ticket list, so if no auto-resolve job is going to
  // run, something has to hand the ticket to the agents. That lives in
  // scheduleTicketAutoResolve, which is why there is no catch here.
  await scheduleTicketAutoResolve(result);
}
