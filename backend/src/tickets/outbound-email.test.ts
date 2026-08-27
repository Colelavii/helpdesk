import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { Job } from "pg-boss";
// Type-only, so it's erased and doesn't load the real module before the mocks.
import type { EmailSendJob } from "./email-queue.ts";

// Outbound email lives in one spec on purpose, for the same reason auto-resolve
// does: bun's mock.module registrations are global, so a spec that stubbed
// send-email.ts to test the queue would also replace the module a second spec
// was trying to test for real.
//
// So nothing first-party is mocked here — only the three leaf boundaries
// (the Postmark SDK, Prisma, pg-boss). send-email.ts, email-queue.ts and
// outbound-message.ts all run for real, and each outcome is steered by what the
// stubbed SDK does.

type SentMessage = {
  From: string;
  To: string;
  ReplyTo?: string;
  Subject: string;
  TextBody?: string;
  MessageStream?: string;
  Headers?: { Name: string; Value: string }[];
};

let sent: SentMessage[] = [];
let sendError: Error | null = null;
let constructedWith: string[] = [];

// Mirrors the real error hierarchy: the code classifies by these constructors,
// so the stubs have to be related the same way.
class PostmarkError extends Error {
  constructor(
    message: string,
    readonly code: number,
    readonly statusCode: number,
  ) {
    super(message);
  }
}
class HttpError extends PostmarkError {}
class ApiInputError extends HttpError {}
class InvalidAPIKeyError extends HttpError {}
class InternalServerError extends HttpError {}
class RateLimitExceededError extends HttpError {}

mock.module("postmark", () => ({
  ServerClient: class {
    constructor(token: string) {
      constructedWith.push(token);
    }
    sendEmail = async (message: SentMessage) => {
      sent.push(message);
      if (sendError) throw sendError;
      return { MessageID: "postmark-delivery-uuid", SubmittedAt: "now" };
    };
  },
  Errors: {
    PostmarkError,
    HttpError,
    ApiInputError,
    InvalidAPIKeyError,
    InternalServerError,
    RateLimitExceededError,
  },
}));

type MessageRow = {
  id: number;
  direction: "inbound" | "outbound";
  fromName: string;
  body: string;
  messageId: string | null;
  inReplyTo: string | null;
  references: string[];
  sentAt: Date | null;
  ticket: { subject: string; requesterEmail: string; requesterName: string };
};

type UpdateCall = { where: { id: number }; data: Record<string, unknown> };

let message: MessageRow | null = null;
let threadParent: { messageId: string | null; references: string[] } | null =
  null;
let updateCalls: UpdateCall[] = [];
let updateError: Error | null = null;

mock.module("../prisma.ts", () => ({
  prisma: {
    message: {
      findUnique: async () => message,
      // Read by replyThreadHeaders to continue the RFC threading chain.
      findFirst: async () => threadParent,
      update: async (args: UpdateCall) => {
        updateCalls.push(args);
        if (updateError) throw updateError;
        return { id: args.where.id };
      },
    },
  },
}));

type SendCall = { name: string; data: unknown };

let sendCalls: SendCall[] = [];
let queueCalls: { name: string; options?: Record<string, unknown> }[] = [];
let enqueueError: Error | null = null;

mock.module("../queue.ts", () => ({
  boss: {
    send: async (name: string, data: unknown) => {
      sendCalls.push({ name, data });
      if (enqueueError) throw enqueueError;
      return "job-id";
    },
    createQueue: async (name: string, options?: Record<string, unknown>) => {
      queueCalls.push({ name, options });
    },
    work: async () => "work-id",
  },
}));

const { sendTicketEmail, MissingPostmarkTokenError, UndeliverableEmailError } =
  await import("./send-email.ts");
const {
  handleEmailSendJobs,
  enqueueEmailSend,
  createEmailSendQueues,
  emailSendQueue,
  emailSendDeadLetterQueue,
} = await import("./email-queue.ts");
const { newOutboundMessageId, replyThreadHeaders } = await import(
  "./outbound-message.ts"
);

const email = {
  to: "ada@students.edu",
  toName: "Ada Student",
  subject: "Cannot log in",
  body: "Try the reset link again.",
  fromName: "Grant Taylor",
};

function header(name: string, index = 0): string | undefined {
  return sent[index]?.Headers?.find((entry) => entry.Name === name)?.Value;
}

function messageRow(overrides: Partial<MessageRow> = {}): MessageRow {
  return {
    id: 11,
    direction: "outbound",
    fromName: "Grant Taylor",
    body: "Try the reset link again.",
    messageId: "ours@helpdesk.test",
    inReplyTo: "theirs@students.edu",
    references: ["theirs@students.edu"],
    sentAt: null,
    ticket: {
      subject: "Cannot log in",
      requesterEmail: "ada@students.edu",
      requesterName: "Ada Student",
    },
    ...overrides,
  };
}

function job(messageRowId = 11): Job<EmailSendJob> {
  return {
    id: "job-1",
    name: emailSendQueue,
    data: { messageRowId },
  } as Job<EmailSendJob>;
}

const originalEnv = { ...process.env };
const originalConsole = { warn: console.warn, error: console.error };

beforeEach(() => {
  sent = [];
  sendError = null;
  constructedWith = [];
  message = messageRow();
  threadParent = null;
  updateCalls = [];
  updateError = null;
  sendCalls = [];
  queueCalls = [];
  enqueueError = null;

  process.env.POSTMARK_SERVER_TOKEN = "test-token";
  process.env.SUPPORT_EMAIL = "support@helpdesk.test";
  process.env.SUPPORT_NAME = "Helpdesk Support";
  delete process.env.POSTMARK_MESSAGE_STREAM;
  // bun loads the real .env into the test process, so anything a developer has
  // configured there would otherwise decide what these assertions see. Both are
  // set in a real .env, so both are pinned here and overridden per test.
  delete process.env.POSTMARK_FROM_EMAIL;
  // A correctly configured return path is the baseline, so only the tests that
  // are about Reply-To have to think about it — and the misconfiguration
  // warnings stay absent from every other test's output.
  process.env.POSTMARK_INBOUND_ADDRESS = "fixture@inbound.postmarkapp.com";
});

afterEach(() => {
  process.env = { ...originalEnv };
  console.warn = originalConsole.warn;
  console.error = originalConsole.error;
});

function silenceLogs() {
  console.warn = () => {};
  console.error = () => {};
}

describe("sendTicketEmail — configuration", () => {
  it("throws MissingPostmarkTokenError when no token is set", async () => {
    delete process.env.POSTMARK_SERVER_TOKEN;

    await expect(sendTicketEmail(email)).rejects.toBeInstanceOf(
      MissingPostmarkTokenError,
    );
    expect(sent).toHaveLength(0);
  });

  it("treats a blank token as no token", async () => {
    process.env.POSTMARK_SERVER_TOKEN = "   ";

    await expect(sendTicketEmail(email)).rejects.toBeInstanceOf(
      MissingPostmarkTokenError,
    );
  });

  it("returns Postmark's delivery id on success", async () => {
    const result = await sendTicketEmail(email);

    expect(result.providerMessageId).toBe("postmark-delivery-uuid");
    expect(constructedWith).toEqual(["test-token"]);
  });

  it("defaults the message stream to outbound and allows an override", async () => {
    await sendTicketEmail(email);
    expect(sent[0]?.MessageStream).toBe("outbound");

    process.env.POSTMARK_MESSAGE_STREAM = "broadcasts";
    await sendTicketEmail(email);
    expect(sent[1]?.MessageStream).toBe("broadcasts");
  });
});

describe("sendTicketEmail — addressing", () => {
  // Postmark only sends From an address on a verified sender signature, which a
  // staff mailbox is not. The agent's name still travels as the display name.
  it("sends From the support address with the author's name", async () => {
    await sendTicketEmail(email);

    expect(sent[0]?.From).toBe('"Grant Taylor" <support@helpdesk.test>');
  });

  // POSTMARK_FROM_EMAIL names the binding constraint — the address must be a
  // verified Postmark sender signature — so it outranks SUPPORT_EMAIL.
  it("prefers POSTMARK_FROM_EMAIL over SUPPORT_EMAIL", async () => {
    process.env.POSTMARK_FROM_EMAIL = "imat@coleencodes.com";

    await sendTicketEmail(email);

    expect(sent[0]?.From).toBe('"Grant Taylor" <imat@coleencodes.com>');
  });

  it("falls back to a default when neither address is set", async () => {
    delete process.env.SUPPORT_EMAIL;

    await sendTicketEmail(email);

    expect(sent[0]?.From).toBe('"Grant Taylor" <support@example.com>');
  });

  it("addresses the recipient by name", async () => {
    await sendTicketEmail(email);

    expect(sent[0]?.To).toBe('"Ada Student" <ada@students.edu>');
  });

  // An unescaped quote would break the header; a newline could inject one.
  it("escapes quotes and strips newlines from a display name", async () => {
    await sendTicketEmail({ ...email, fromName: 'Ada "The\nBoss" Smith' });

    expect(sent[0]?.From).toBe(
      '"Ada \\"The Boss\\" Smith" <support@helpdesk.test>',
    );
  });

  // Reply-To is the return path for the whole conversation: it has to be the
  // Postmark inbound address, because the From is a verified sender signature
  // that generally lands in a person's mailbox (or a forwarding alias) and never
  // reaches the webhook.
  describe("Reply-To", () => {
    const inbound = "033d2f9cce7928db345ac1a29fa54a49@inbound.postmarkapp.com";

    it("is the configured Postmark inbound address", async () => {
      process.env.POSTMARK_INBOUND_ADDRESS = inbound;

      await sendTicketEmail(email);

      expect(sent[0]?.ReplyTo).toBe(inbound);
    });

    // The regression this replaced: a delivered email came back with Reply-To
    // equal to From, so a customer's reply bypassed the helpdesk entirely.
    it("is never the From address", async () => {
      process.env.POSTMARK_INBOUND_ADDRESS = inbound;
      process.env.POSTMARK_FROM_EMAIL = "imat@coleencodes.com";

      await sendTicketEmail(email);

      expect(sent[0]?.From).toBe('"Grant Taylor" <imat@coleencodes.com>');
      expect(sent[0]?.ReplyTo).not.toBe("imat@coleencodes.com");
      expect(sent[0]?.ReplyTo).not.toContain("coleencodes.com");
      expect(sent[0]?.ReplyTo).toBe(inbound);
    });

    it("is unaffected by the From address changing", async () => {
      process.env.POSTMARK_INBOUND_ADDRESS = inbound;
      process.env.POSTMARK_FROM_EMAIL = "help@elsewhere.test";

      await sendTicketEmail(email);

      expect(sent[0]?.ReplyTo).toBe(inbound);
    });

    it("trims a padded value", async () => {
      process.env.POSTMARK_INBOUND_ADDRESS = `  ${inbound}  `;

      await sendTicketEmail(email);

      expect(sent[0]?.ReplyTo).toBe(inbound);
    });

    // Not configured: we send no Reply-To, Postmark falls back to From, and a
    // reply is lost. Warn rather than throw — a reply the agent wrote is worth
    // delivering even when the return path is misconfigured.
    it("warns and sends no Reply-To when the inbound address is unset", async () => {
      delete process.env.POSTMARK_INBOUND_ADDRESS;
      const warnings: string[] = [];
      console.warn = (...args: unknown[]) => warnings.push(String(args[0]));

      await sendTicketEmail(email);

      expect(sent[0]?.ReplyTo).toBeUndefined();
      expect(warnings[0]).toContain("POSTMARK_INBOUND_ADDRESS is not set");
      expect(warnings[0]).toContain("never join the ticket");
    });

    // Exactly the misconfiguration that caused the regression, caught up front.
    it("warns when the inbound address is the From address", async () => {
      process.env.POSTMARK_FROM_EMAIL = "imat@coleencodes.com";
      process.env.POSTMARK_INBOUND_ADDRESS = "IMAT@coleencodes.com";
      const warnings: string[] = [];
      console.warn = (...args: unknown[]) => warnings.push(String(args[0]));

      await sendTicketEmail(email);

      // Still sent — the warning is a diagnostic, not a veto.
      expect(sent).toHaveLength(1);
      expect(warnings[0]).toContain("same as the From address");
    });

    it("stays quiet when it is configured correctly", async () => {
      process.env.POSTMARK_INBOUND_ADDRESS = inbound;
      const warnings: string[] = [];
      console.warn = (...args: unknown[]) => warnings.push(String(args[0]));

      await sendTicketEmail(email);

      expect(warnings).toEqual([]);
    });
  });

  it("prefixes the subject with Re: without doubling it", async () => {
    await sendTicketEmail(email);
    expect(sent[0]?.Subject).toBe("Re: Cannot log in");

    await sendTicketEmail({ ...email, subject: "RE: already a reply" });
    expect(sent[1]?.Subject).toBe("RE: already a reply");
  });

  it("sends the body as plain text", async () => {
    await sendTicketEmail(email);

    expect(sent[0]?.TextBody).toBe("Try the reset link again.");
  });
});

describe("sendTicketEmail — threading headers", () => {
  it("sends our Message-Id in brackets, with X-PM-KeepID", async () => {
    await sendTicketEmail({ ...email, messageId: "abc@helpdesk.test" });

    expect(header("Message-ID")).toBe("<abc@helpdesk.test>");
    // Without this Postmark replaces the id with one of its own.
    expect(header("X-PM-KeepID")).toBe("true");
  });

  it("brackets In-Reply-To and space-separates References", async () => {
    await sendTicketEmail({
      ...email,
      inReplyTo: "parent@x.edu",
      references: ["one@x.edu", "two@x.edu"],
    });

    expect(header("In-Reply-To")).toBe("<parent@x.edu>");
    expect(header("References")).toBe("<one@x.edu> <two@x.edu>");
  });

  it("omits every threading header when there is nothing to thread", async () => {
    await sendTicketEmail({ ...email, references: [] });

    expect(sent[0]?.Headers).toEqual([]);
  });
});

describe("sendTicketEmail — error classification", () => {
  // These cannot succeed on a retry, so they surface as undeliverable and the
  // worker records them instead of burning attempts.
  it("maps a rejected payload to UndeliverableEmailError", async () => {
    sendError = new ApiInputError("Invalid To address", 300, 422);

    const error = await sendTicketEmail(email).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(UndeliverableEmailError);
    expect((error as InstanceType<typeof UndeliverableEmailError>).code).toBe(
      300,
    );
    expect((error as Error).message).toBe("Invalid To address");
  });

  it("maps a rejected token to UndeliverableEmailError", async () => {
    sendError = new InvalidAPIKeyError("Bad token", 10, 401);

    await expect(sendTicketEmail(email)).rejects.toBeInstanceOf(
      UndeliverableEmailError,
    );
  });

  // These are worth another attempt, so they propagate untouched for the queue.
  it("passes a server error through for the queue to retry", async () => {
    sendError = new InternalServerError("Server error", 0, 500);

    const error = await sendTicketEmail(email).catch((e: unknown) => e);

    expect(error).toBe(sendError);
    expect(error).not.toBeInstanceOf(UndeliverableEmailError);
  });

  it("passes a rate limit through for the queue to retry", async () => {
    sendError = new RateLimitExceededError("Slow down", 0, 429);

    await expect(sendTicketEmail(email)).rejects.toBe(sendError);
  });

  it("passes a network failure through for the queue to retry", async () => {
    sendError = new Error("socket hang up");

    await expect(sendTicketEmail(email)).rejects.toBe(sendError);
  });
});

describe("newOutboundMessageId", () => {
  // RFC 5322 expects the right-hand side to be a domain the sender owns, so it
  // follows the address the mail is actually sent From.
  it("roots the id in the sending address' domain", () => {
    expect(newOutboundMessageId()).toMatch(/^[0-9a-f-]{36}@helpdesk\.test$/);
  });

  it("follows POSTMARK_FROM_EMAIL when that is the sender", () => {
    process.env.POSTMARK_FROM_EMAIL = "imat@coleencodes.com";

    expect(newOutboundMessageId()).toMatch(/^[0-9a-f-]{36}@coleencodes\.com$/);
  });

  it("is unique per call", () => {
    expect(newOutboundMessageId()).not.toBe(newOutboundMessageId());
  });

  // Stored bare so it compares equal to the bracket-stripped ids the inbound
  // side normalizes to — that comparison is what threads a reply.
  it("carries no angle brackets", () => {
    expect(newOutboundMessageId()).not.toInclude("<");
  });
});

describe("replyThreadHeaders", () => {
  it("starts a fresh chain when no message has a Message-Id", async () => {
    threadParent = null;

    expect(await replyThreadHeaders(7)).toEqual({ references: [] });
  });

  it("replies to the newest message and extends its chain", async () => {
    threadParent = {
      messageId: "second@students.edu",
      references: ["first@students.edu"],
    };

    expect(await replyThreadHeaders(7)).toEqual({
      inReplyTo: "second@students.edu",
      references: ["first@students.edu", "second@students.edu"],
    });
  });

  // A malformed chain that already names its own parent would otherwise grow a
  // duplicate on every exchange.
  it("does not repeat an id already in the chain", async () => {
    threadParent = {
      messageId: "second@students.edu",
      references: ["first@students.edu", "second@students.edu"],
    };

    expect((await replyThreadHeaders(7)).references).toEqual([
      "first@students.edu",
      "second@students.edu",
    ]);
  });

  it("caps a long chain, keeping the nearest ancestors", async () => {
    const ids = Array.from({ length: 120 }, (_, index) => `id-${index}@x.edu`);
    threadParent = { messageId: "newest@x.edu", references: ids };

    const { references } = await replyThreadHeaders(7);

    expect(references).toHaveLength(100);
    expect(references.at(-1)).toBe("newest@x.edu");
    expect(references).not.toContain("id-0@x.edu");
  });
});

describe("createEmailSendQueues", () => {
  // pg-boss rejects a deadLetter naming a queue that doesn't exist yet.
  it("creates the dead-letter queue before the queue that references it", async () => {
    await createEmailSendQueues();

    expect(queueCalls.map((call) => call.name)).toEqual([
      emailSendDeadLetterQueue,
      emailSendQueue,
    ]);
    expect(queueCalls[1]?.options?.deadLetter).toBe(emailSendDeadLetterQueue);
    expect(queueCalls[1]?.options?.retryLimit).toBe(5);
  });
});

describe("handleEmailSendJobs — sending", () => {
  it("sends the message with its threading ids and records the send", async () => {
    await handleEmailSendJobs([job()]);

    expect(sent).toHaveLength(1);
    expect(sent[0]?.To).toBe('"Ada Student" <ada@students.edu>');
    expect(sent[0]?.From).toBe('"Grant Taylor" <support@helpdesk.test>');
    expect(sent[0]?.Subject).toBe("Re: Cannot log in");
    expect(header("Message-ID")).toBe("<ours@helpdesk.test>");
    expect(header("In-Reply-To")).toBe("<theirs@students.edu>");

    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0]?.where.id).toBe(11);
    expect(updateCalls[0]?.data.sentAt).toBeInstanceOf(Date);
    // A failure from an earlier attempt must not outlive the success.
    expect(updateCalls[0]?.data.deliveryError).toBeNull();
  });

  it("works every job in a batch", async () => {
    await handleEmailSendJobs([job(11), job(11)]);

    expect(sent).toHaveLength(2);
  });

  it("sends no threading headers for a message that has no ids", async () => {
    message = messageRow({ messageId: null, inReplyTo: null, references: [] });

    await handleEmailSendJobs([job()]);

    expect(sent[0]?.Headers).toEqual([]);
  });
});

describe("handleEmailSendJobs — nothing to do", () => {
  // The ticket was deleted between enqueue and now; messages cascade with it.
  it("skips a message that no longer exists", async () => {
    silenceLogs();
    message = null;

    await handleEmailSendJobs([job()]);

    expect(sent).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);
  });

  // Nothing enqueues inbound mail, and sending a student their own message back
  // would be worse than dropping the job.
  it("refuses to send an inbound message", async () => {
    silenceLogs();
    message = messageRow({ direction: "inbound" });

    await handleEmailSendJobs([job()]);

    expect(sent).toHaveLength(0);
  });

  // What the sentAt guard actually buys: a job redelivered after the write
  // committed (a crash or job expiry before pg-boss acked it), or a second
  // enqueue for the same row, is a no-op.
  it("does not resend a message already marked sent", async () => {
    message = messageRow({ sentAt: new Date("2024-03-20T11:00:05.000Z") });

    await handleEmailSendJobs([job()]);

    expect(sent).toHaveLength(0);
    expect(updateCalls).toHaveLength(0);
  });
});

describe("handleEmailSendJobs — failures", () => {
  // Configuration, not a fault: retrying cannot conjure a token, so the job
  // completes and the message carries the explanation.
  it("completes and records when sending is not configured", async () => {
    silenceLogs();
    delete process.env.POSTMARK_SERVER_TOKEN;

    await handleEmailSendJobs([job()]);

    expect(sent).toHaveLength(0);
    expect(updateCalls[0]?.data).toEqual({
      deliveryError:
        "Email sending is not configured, so this reply was not delivered.",
    });
  });

  it("completes and records the reason when Postmark rejects the reply", async () => {
    silenceLogs();
    sendError = new ApiInputError("inactive recipient", 406, 422);

    await handleEmailSendJobs([job()]);

    expect(updateCalls[0]?.data.deliveryError).toBe(
      "Postmark rejected this reply: inactive recipient",
    );
  });

  // Transient: recorded so the ticket shows something went wrong, then rethrown
  // so pg-boss retries with backoff and eventually dead-letters it.
  it("records and rethrows a transient failure", async () => {
    silenceLogs();
    sendError = new InternalServerError("Server error", 0, 500);

    await expect(handleEmailSendJobs([job()])).rejects.toBe(sendError);

    expect(updateCalls[0]?.data.deliveryError).toBe(
      "Sending this reply failed and will be retried.",
    );
  });

  // Losing the annotation must not mask the original failure.
  it("still rethrows the send failure when recording it fails", async () => {
    silenceLogs();
    sendError = new InternalServerError("Server error", 0, 500);
    updateError = new Error("database is down");

    await expect(handleEmailSendJobs([job()])).rejects.toBe(sendError);
  });

  // Documents the at-least-once edge case rather than asserting it away.
  // Postmark accepted the send, but recording it failed: the job is reported as
  // transient and retried, and because sentAt was never written the retry sends
  // a second copy. Postmark's /email has no idempotency key, so nothing cheap
  // closes this. If it ever needs closing, that is a deliberate piece of work.
  it("re-sends when the send succeeded but recording it failed", async () => {
    silenceLogs();
    updateError = new Error("database is down");

    // First attempt: the email goes out, then the write fails and the job is
    // retried rather than completed.
    await expect(handleEmailSendJobs([job()])).rejects.toBe(updateError);
    expect(sent).toHaveLength(1);

    // The retry sees sentAt still null — because the write never landed — and
    // mails the student again. This is the duplicate the guard cannot prevent.
    updateError = null;
    await handleEmailSendJobs([job()]);

    expect(sent).toHaveLength(2);
    expect(updateCalls.at(-1)?.data.sentAt).toBeInstanceOf(Date);
  });
});

describe("enqueueEmailSend", () => {
  it("sends the message row id to the email queue", async () => {
    await enqueueEmailSend(42);

    expect(sendCalls).toEqual([
      { name: emailSendQueue, data: { messageRowId: 42 } },
    ]);
  });

  // The reply is already committed; a queue that refused the job must not turn
  // an otherwise successful request into an error. It is recorded instead.
  it("never throws when the queue refuses the job, and records it", async () => {
    silenceLogs();
    enqueueError = new Error("queue is down");

    await enqueueEmailSend(42);

    expect(updateCalls[0]?.data).toEqual({
      deliveryError: "This reply could not be queued for sending.",
    });
  });

  it("stays silent when both the queue and the annotation fail", async () => {
    silenceLogs();
    enqueueError = new Error("queue is down");
    updateError = new Error("database is down");

    await enqueueEmailSend(42);
  });
});
