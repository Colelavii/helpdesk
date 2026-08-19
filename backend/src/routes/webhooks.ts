import { Router, type Request, type Response } from "express";
import { requireInboundSecret } from "../require-inbound-secret.ts";
import { parseBody } from "../parse-body.ts";
import {
  inboundEmailSchema,
  ingestInboundEmail,
} from "../tickets/ingest-inbound-email.ts";
import { enqueueTicketClassification } from "../tickets/classification-queue.ts";

export const webhooksRouter = Router();

// Provider-agnostic inbound-email webhook: turns a received email into a ticket
// (threading replies onto the existing ticket). Guarded by a shared secret; a
// future Mailgun adapter would translate Mailgun's payload into this contract.
webhooksRouter.post(
  "/inbound-email",
  requireInboundSecret,
  async (req: Request, res: Response) => {
    const data = parseBody(inboundEmailSchema, req.body, res);
    if (!data) return;
    const result = await ingestInboundEmail(data);

    // Enqueued before the acknowledgement so the hand-off is durable: once the
    // provider is told we have the email, the classification job is already
    // recorded and survives a crash or deploy. It's only a local insert, so it
    // costs the response nothing like a model call would. A queue that is down
    // must still not fail the delivery — the ticket is stored, and an
    // uncategorised ticket is a dropdown an agent can set — hence the catch.
    await enqueueTicketClassification(result).catch((error: unknown) => {
      console.error(
        `Failed to enqueue classification for ticket ${result.ticketId}`,
        error,
      );
    });

    res.status(result.status === "created" ? 201 : 200).json(result);
  },
);
