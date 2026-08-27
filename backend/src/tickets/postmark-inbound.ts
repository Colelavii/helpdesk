import { z } from "zod";
import {
  inboundEmailLimits,
  type InboundEmailPayload,
} from "./ingest-inbound-email.ts";

// Postmark's inbound webhook payload, narrowed to the fields a ticket needs.
// Everything is optional on purpose: Postmark sends far more than this (ToFull,
// Cc, Tag, Attachments, spam headers), unknown keys are stripped by Zod, and a
// field we don't strictly need must never be the reason a student's email 400s
// and gets retried ten times into the Inbound Errors dashboard.
//
// Two details of this payload are easy to get wrong:
//   - `MessageID` is Postmark's own UUID for the delivery, NOT the email's
//     RFC 5322 Message-Id. The real one is in `Headers`.
//   - `Headers` is a flat array of { Name, Value }, so In-Reply-To/References
//     have to be looked up by name rather than read off an object.
const postmarkAddressSchema = z.object({
  Email: z.string().optional(),
  Name: z.string().optional(),
});

const postmarkHeaderSchema = z.object({
  Name: z.string(),
  Value: z.string(),
});

export const postmarkInboundSchema = z.object({
  From: z.string().optional(),
  FromName: z.string().optional(),
  FromFull: postmarkAddressSchema.optional(),
  Subject: z.string().optional(),
  TextBody: z.string().optional(),
  HtmlBody: z.string().optional(),
  // Postmark's own attempt at the reply with the quoted history removed. Present
  // only on replies, and only when it could work out where the quote started.
  StrippedTextReply: z.string().optional(),
  MessageID: z.string().optional(),
  Headers: z.array(postmarkHeaderSchema).optional(),
});

export type PostmarkInboundPayload = z.infer<typeof postmarkInboundSchema>;

// Marks where content was cut rather than dropping it silently: an agent reading
// a clipped ticket needs to know the student wrote more than this.
const TRUNCATION_NOTICE = "\n\n[…truncated — see the full email in Postmark.]";

// Header names are matched case-insensitively: the same header arrives as
// "Message-ID" from one sending client and "Message-Id" from another.
function header(
  headers: PostmarkInboundPayload["Headers"],
  name: string,
): string | undefined {
  const match = headers?.find(
    (entry) => entry.Name.toLowerCase() === name.toLowerCase(),
  );
  return match?.Value.trim() || undefined;
}

function truncate(value: string, limit: number): string {
  if (value.length <= limit) return value;
  // A limit too small to hold the notice would otherwise produce a message that
  // is nothing but the notice.
  if (limit <= TRUNCATION_NOTICE.length) return value.slice(0, limit);
  return value.slice(0, limit - TRUNCATION_NOTICE.length) + TRUNCATION_NOTICE;
}

// "Ada Student" <ada@x.edu> → ada@x.edu. Only used when FromFull.Email is
// missing; Postmark normally supplies it already parsed.
function addressFrom(raw: string): string {
  return raw.match(/<([^>]+)>/)?.[1]?.trim() ?? raw.trim();
}

/**
 * Maps a Postmark inbound webhook payload onto the provider-agnostic inbound
 * email contract. Returns the pre-validation shape — the caller hands it to
 * `inboundEmailSchema`, which normalizes the subject, sanitizes the HTML and
 * strips the angle brackets off every Message-Id.
 *
 * Attachments are deliberately dropped: attachment storage is still an open
 * decision (see implementation-plan.md), and inventing one here would commit the
 * project to it. The text body is what the thread renders and what AI reads.
 */
export function postmarkToInboundEmail(
  payload: PostmarkInboundPayload,
): InboundEmailPayload {
  const fromEmail =
    payload.FromFull?.Email?.trim() ||
    (payload.From ? addressFrom(payload.From) : "");

  // fromName is required and non-empty in the contract, but Postmark reports an
  // empty Name for anyone whose client doesn't send a display name. Falling back
  // to the address' local part keeps a nameless sender from 400ing; without it
  // the most ordinary email in the world would be the one we reject.
  const fromName =
    payload.FromFull?.Name?.trim() ||
    payload.FromName?.trim() ||
    fromEmail.split("@")[0] ||
    "Unknown sender";

  // The stripped reply is preferred where Postmark produced one: it's the part
  // the student actually wrote, and quoting the whole thread back at us would
  // eat the body cap with text already stored on the ticket.
  const strippedReply = payload.StrippedTextReply?.trim();
  const body = strippedReply || payload.TextBody || "";

  const html = payload.HtmlBody?.trim();
  // Oversized HTML is omitted rather than clipped: cutting markup mid-document
  // renders a message that looks complete but isn't, whereas the plain-text body
  // is always present and carries the same words.
  const bodyHtml =
    html && html.length <= inboundEmailLimits.bodyHtml ? html : undefined;

  const references = header(payload.Headers, "References")
    // RFC 5322 folds References onto several lines and separates ids by
    // whitespace, so the header is one string holding the whole ancestry.
    ?.split(/\s+/)
    .filter((id) => id !== "")
    // Oldest first, so when a long thread overruns the cap the nearest
    // ancestors — the ones most likely to match this ticket — are the keepers.
    .slice(-inboundEmailLimits.references);

  return {
    fromEmail,
    fromName,
    subject: truncate(payload.Subject ?? "", inboundEmailLimits.subject),
    body: truncate(body, inboundEmailLimits.body),
    bodyHtml,
    // Prefer the email's own Message-Id: it's what a later reply will name in
    // In-Reply-To, so it's the only id threading can match on. Postmark's UUID
    // is the fallback — useless for threading, but it still makes a redelivery
    // of an email whose client sent no Message-Id idempotent instead of
    // creating the same ticket ten times over.
    messageId: header(payload.Headers, "Message-ID") ?? payload.MessageID,
    inReplyTo: header(payload.Headers, "In-Reply-To"),
    references,
  };
}
