import type { NextFunction, Request, Response } from "express";
import { timingSafeEqual } from "node:crypto";

// Auth for the inbound-email webhook: a shared secret, accepted three ways.
//
// This is the mechanism, not a placeholder for a signature check — Postmark does
// not sign inbound webhooks. Its documented options are credentials carried in
// the webhook URL and, optionally, a firewall allow-list of Postmark's IP
// ranges. So the secret has to be reachable without setting a request header,
// which Postmark's inbound configuration cannot do:
//
//   X-Inbound-Secret: <secret>                    (our own callers, curl, tests)
//   ?secret=<secret>                              (query string on the hook URL)
//   Authorization: Basic base64(anything:<secret>) (https://x:<secret>@host/...)
//
// Basic auth is the form to prefer in production: a query string is more likely
// to be written to an access log than the Authorization header is.
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

// The username half is ignored: Postmark's URL form is user:pass@host, and the
// password is the only half worth treating as the secret. Anything that isn't a
// well-formed Basic credential yields undefined and falls through to a 401.
function basicAuthPassword(headerValue: string | undefined): string | undefined {
  const encoded = headerValue?.match(/^Basic +(.+)$/i)?.[1];
  if (!encoded) return undefined;
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  return separator === -1 ? undefined : decoded.slice(separator + 1);
}

export function requireInboundSecret(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const headerSecret = req.header("x-inbound-secret");

  const querySecret =
    typeof req.query.secret === "string" ? req.query.secret : undefined;

  const provided =
    headerSecret ??
    querySecret ??
    basicAuthPassword(req.header("authorization"));

  if (!provided || !matchesSecret(provided)) {
    // 401, not 403, on purpose: Postmark abandons a webhook permanently on 403
    // but retries a non-2xx for up to six hours. A rejection here is far more
    // likely to be a secret we rotated on one side only, and retrying means
    // those emails still arrive once it's fixed.
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  next();
}
