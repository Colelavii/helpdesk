import { Errors, ServerClient } from "postmark";
import { inboundReplyToAddress, supportIdentity } from "./support-identity.ts";

// Thrown when POSTMARK_SERVER_TOKEN is unset. Configuration rather than a fault,
// so the send worker records it and completes instead of burning retries — and
// the backend still boots and serves everything else without a token, exactly as
// it does without an Anthropic key.
export class MissingPostmarkTokenError extends Error {
  constructor() {
    super("POSTMARK_SERVER_TOKEN is not configured");
    this.name = "MissingPostmarkTokenError";
  }
}

// A rejection that retrying cannot fix: a malformed address, a recipient
// Postmark has deactivated after hard bounces, or a token it won't accept.
export class UndeliverableEmailError extends Error {
  constructor(
    message: string,
    readonly code: number,
  ) {
    super(message);
    this.name = "UndeliverableEmailError";
  }
}

const defaultMessageStream = "outbound";

// Constructed per call rather than as a module singleton, mirroring
// anthropicClient(): the token is optional, so the module must not fail at
// import, and there is no connection pool worth reusing.
function postmarkClient(): ServerClient | null {
  const token = process.env.POSTMARK_SERVER_TOKEN?.trim();
  if (!token) return null;
  return new ServerClient(token);
}

function messageStream(): string {
  return process.env.POSTMARK_MESSAGE_STREAM?.trim() || defaultMessageStream;
}

// `"Ada Student" <ada@x.edu>`. The display name is quoted rather than
// interpolated bare: an unescaped quote or backslash in a name would otherwise
// break the header, and a newline would let it inject one of its own.
function formatAddress(name: string, email: string): string {
  const safeName = name.replace(/[\r\n]/g, " ").replace(/(["\\])/g, "\\$1");
  return `"${safeName}" <${email}>`;
}

// The ticket subject is stored with any Re:/Fwd: prefix already stripped (see
// normalizeSubject), so the prefix is added back here — a mail client shows it
// as part of the thread, and our own inbound side strips it again on the way in.
function replySubject(subject: string): string {
  return /^re:/i.test(subject) ? subject : `Re: ${subject}`;
}

export interface OutboundEmail {
  to: string;
  toName: string;
  subject: string;
  body: string;
  // Whose name the student sees. The agent for a reply they wrote, the support
  // identity for one the auto-resolve worker wrote.
  fromName: string;
  // The RFC Message-Id we minted and stored on the message row.
  messageId?: string;
  inReplyTo?: string;
  references?: string[];
}

/**
 * Sends one ticket email through Postmark and returns Postmark's delivery id.
 *
 * The From address is always the support identity, never the agent's own:
 * Postmark will only send From an address covered by a verified sender
 * signature, and a staff member's mailbox is not one. The agent's name still
 * rides along as the display name, and the message row keeps their address for
 * attribution.
 */
export async function sendTicketEmail(
  email: OutboundEmail,
): Promise<{ providerMessageId: string }> {
  const client = postmarkClient();
  if (!client) throw new MissingPostmarkTokenError();

  const support = supportIdentity();
  const headers: { Name: string; Value: string }[] = [];

  if (email.messageId) {
    headers.push({ Name: "Message-ID", Value: `<${email.messageId}>` });
    // Postmark replaces a custom Message-ID unless explicitly told not to.
    // Its docs describe this for SMTP only, but a real send confirmed the Email
    // API honours it as well. Even if that regressed, threading would survive:
    // the References below carry the ids of the student's own earlier messages,
    // which their reply echoes back.
    headers.push({ Name: "X-PM-KeepID", Value: "true" });
  }
  if (email.inReplyTo) {
    headers.push({ Name: "In-Reply-To", Value: `<${email.inReplyTo}>` });
  }
  if (email.references?.length) {
    headers.push({
      Name: "References",
      Value: email.references.map((id) => `<${id}>`).join(" "),
    });
  }

  // Reply-To carries the whole "student replies land back on the ticket" half of
  // the product, so both ways of getting it wrong are called out loudly rather
  // than left to be discovered by a customer whose reply vanished.
  const replyTo = inboundReplyToAddress();
  if (!replyTo) {
    console.warn(
      "POSTMARK_INBOUND_ADDRESS is not set, so this email carries no Reply-To. " +
        "Postmark defaults Reply-To to the From address, which does not reach " +
        "the inbound webhook — a reply to it will never join the ticket.",
    );
  } else if (replyTo.toLowerCase() === support.email.toLowerCase()) {
    console.warn(
      `POSTMARK_INBOUND_ADDRESS (${replyTo}) is the same as the From address. ` +
        "Unless that address forwards into the inbound webhook, replies will " +
        "not join the ticket. It should normally be the Postmark inbound " +
        "address (Servers → Settings → Inbound).",
    );
  }

  try {
    const response = await client.sendEmail({
      From: formatAddress(email.fromName, support.email),
      To: formatAddress(email.toName, email.to),
      // Deliberately the inbound address, never the From: see
      // inboundReplyToAddress().
      ReplyTo: replyTo,
      Subject: replySubject(email.subject),
      TextBody: email.body,
      MessageStream: messageStream(),
      Headers: headers,
    });

    return { providerMessageId: response.MessageID };
  } catch (error) {
    // ApiInputError covers a rejected payload and an inactive recipient;
    // InvalidAPIKeyError is a token Postmark won't accept. None of the three
    // improves by being tried again, so they are reported as undeliverable and
    // recorded against the message rather than retried.
    if (
      error instanceof Errors.ApiInputError ||
      error instanceof Errors.InvalidAPIKeyError
    ) {
      throw new UndeliverableEmailError(error.message, error.code);
    }
    // Everything else — a 500, a rate limit, a dropped connection — is worth
    // another attempt, so it propagates to the queue untouched.
    throw error;
  }
}
