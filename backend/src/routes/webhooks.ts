import { Router, type Request, type Response } from "express";
import { requireInboundSecret } from "../require-inbound-secret.ts";
import { parseBody } from "../parse-body.ts";
import {
  inboundEmailSchema,
  ingestInboundEmail,
} from "../tickets/ingest-inbound-email.ts";
import { classifyTicketInBackground } from "../tickets/auto-classify-ticket.ts";

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
    res.status(result.status === "created" ? 201 : 200).json(result);

    // AI classification is kicked off after the response and deliberately not
    // awaited: the provider retries an acknowledgement that's slow to arrive,
    // which would duplicate work here (and a model outage would turn every
    // inbound email into a failed delivery). It takes the whole result and
    // decides for itself whether the ingest produced anything to classify.
    classifyTicketInBackground(result);
  },
);
