import type { NextFunction, Request, Response } from "express";
import { timingSafeEqual } from "node:crypto";

// Provider-agnostic auth for the inbound-email webhook: callers must send the
// shared secret in the X-Inbound-Secret header. A future Mailgun adapter would
// verify a provider signature instead; this is the interim boundary.
const secret = process.env.INBOUND_EMAIL_SECRET;

if (!secret) {
  throw new Error("INBOUND_EMAIL_SECRET must be set");
}

// timingSafeEqual requires equal-length buffers, so length mismatch is its own
// (constant-ish) early-out — comparing the raw byte lengths leaks nothing useful.
function matchesSecret(provided: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(secret as string);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function requireInboundSecret(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const provided = req.header("x-inbound-secret");
  if (!provided || !matchesSecret(provided)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}
