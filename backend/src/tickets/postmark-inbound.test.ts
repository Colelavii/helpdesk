import { describe, expect, it } from "bun:test";
import {
  inboundEmailSchema,
  inboundEmailLimits,
} from "./ingest-inbound-email.ts";
import {
  postmarkInboundSchema,
  postmarkToInboundEmail,
  type PostmarkInboundPayload,
} from "./postmark-inbound.ts";

// A trimmed-down version of the payload in Postmark's inbound webhook docs.
function payload(
  overrides: Partial<PostmarkInboundPayload> = {},
): PostmarkInboundPayload {
  return {
    From: "ada@students.edu",
    FromName: "Ada Student",
    FromFull: { Email: "ada@students.edu", Name: "Ada Student" },
    Subject: "Cannot log in",
    TextBody: "My password reset link expired.",
    HtmlBody: "<p>My password reset link expired.</p>",
    MessageID: "73e6d360-66eb-11e1-8e72-a8904824019b",
    Headers: [
      { Name: "X-Spam-Status", Value: "No" },
      { Name: "Message-ID", Value: "<abc123@mail.students.edu>" },
    ],
    ...overrides,
  };
}

// The adapter's output only reaches the database through inboundEmailSchema, so
// most assertions run on the parsed result — that is the shape ingest receives.
function mapAndParse(input: PostmarkInboundPayload) {
  return inboundEmailSchema.parse(postmarkToInboundEmail(input));
}

describe("postmarkInboundSchema", () => {
  it("accepts the documented payload and strips unknown fields", () => {
    const parsed = postmarkInboundSchema.parse({
      ...payload(),
      Tag: "TestTag",
      MessageStream: "inbound",
      ToFull: [{ Email: "hash@inbound.postmarkapp.com", Name: "" }],
      Attachments: [{ Name: "test.txt", ContentLength: 45 }],
    });

    expect(parsed.Subject).toBe("Cannot log in");
    expect(parsed).not.toHaveProperty("Tag");
    expect(parsed).not.toHaveProperty("Attachments");
  });

  it("accepts a payload missing every optional field", () => {
    expect(postmarkInboundSchema.parse({})).toEqual({});
  });
});

describe("postmarkToInboundEmail — sender", () => {
  it("takes the address and name from FromFull", () => {
    const result = mapAndParse(payload());
    expect(result.fromEmail).toBe("ada@students.edu");
    expect(result.fromName).toBe("Ada Student");
  });

  it("parses the address out of From when FromFull has no Email", () => {
    const result = mapAndParse(
      payload({ FromFull: { Name: "Ada Student" }, From: '"Ada" <ada@x.edu>' }),
    );
    expect(result.fromEmail).toBe("ada@x.edu");
  });

  // fromName is required and min(1) in the contract, and plenty of mail clients
  // send no display name at all — that must not be a 400.
  it("falls back to the local part when no display name is sent", () => {
    const result = mapAndParse(
      payload({
        FromFull: { Email: "ada@students.edu", Name: "" },
        FromName: "",
      }),
    );
    expect(result.fromName).toBe("ada");
  });
});

describe("postmarkToInboundEmail — subject and body", () => {
  it("normalizes a reply subject through the contract", () => {
    const result = mapAndParse(payload({ Subject: "Re: Re: Cannot log in" }));
    expect(result.subject).toBe("Cannot log in");
  });

  it("falls back to (no subject) for an empty Subject", () => {
    const result = mapAndParse(payload({ Subject: "" }));
    expect(result.subject).toBe("(no subject)");
  });

  it("prefers StrippedTextReply over the quoted TextBody", () => {
    const result = mapAndParse(
      payload({
        StrippedTextReply: "Still broken, thanks.",
        TextBody: "Still broken, thanks.\n\n> On Monday you wrote:\n> Try this",
      }),
    );
    expect(result.body).toBe("Still broken, thanks.");
  });

  it("uses TextBody when StrippedTextReply is empty", () => {
    const result = mapAndParse(
      payload({ StrippedTextReply: "   ", TextBody: "First message." }),
    );
    expect(result.body).toBe("First message.");
  });

  // A long real-world email must become a ticket, not a 400 that Postmark
  // retries ten times and then files as an Inbound Error.
  it("truncates an over-long body to the contract cap with a notice", () => {
    const result = mapAndParse(
      payload({ TextBody: "x".repeat(inboundEmailLimits.body + 500) }),
    );
    expect(result.body.length).toBeLessThanOrEqual(inboundEmailLimits.body);
    expect(result.body).toContain("truncated");
  });

  it("truncates an over-long subject rather than rejecting it", () => {
    const result = mapAndParse(
      payload({ Subject: "s".repeat(inboundEmailLimits.subject + 50) }),
    );
    expect(result.subject.length).toBeLessThanOrEqual(
      inboundEmailLimits.subject,
    );
  });

  it("sanitizes HtmlBody through the contract", () => {
    const result = mapAndParse(
      payload({ HtmlBody: "<p>Hi<script>alert(1)</script></p>" }),
    );
    expect(result.bodyHtml).toBe("<p>Hi</p>");
  });

  it("omits HtmlBody entirely when it exceeds the cap", () => {
    const result = mapAndParse(
      payload({ HtmlBody: `<p>${"x".repeat(inboundEmailLimits.bodyHtml)}</p>` }),
    );
    expect(result.bodyHtml).toBeUndefined();
    expect(result.body).toBe("My password reset link expired.");
  });

  it("leaves bodyHtml unset for a plain-text email", () => {
    const result = mapAndParse(payload({ HtmlBody: "" }));
    expect(result.bodyHtml).toBeUndefined();
  });
});

describe("postmarkToInboundEmail — threading ids", () => {
  it("uses the RFC Message-ID header, bracket-stripped, over Postmark's UUID", () => {
    const result = mapAndParse(payload());
    expect(result.messageId).toBe("abc123@mail.students.edu");
  });

  it("matches the Message-Id header case-insensitively", () => {
    const result = mapAndParse(
      payload({ Headers: [{ Name: "Message-Id", Value: "<lower@x.edu>" }] }),
    );
    expect(result.messageId).toBe("lower@x.edu");
  });

  // No Message-Id header means threading is impossible either way, but a
  // redelivery must still dedupe instead of opening a second ticket.
  it("falls back to Postmark's MessageID when the header is absent", () => {
    const result = mapAndParse(payload({ Headers: [] }));
    expect(result.messageId).toBe("73e6d360-66eb-11e1-8e72-a8904824019b");
  });

  it("carries In-Reply-To across, bracket-stripped", () => {
    const result = mapAndParse(
      payload({
        Headers: [{ Name: "In-Reply-To", Value: "<parent@helpdesk.test>" }],
      }),
    );
    expect(result.inReplyTo).toBe("parent@helpdesk.test");
  });

  it("splits the References header into bare ids", () => {
    const result = mapAndParse(
      payload({
        Headers: [
          { Name: "References", Value: "<one@x.edu>\r\n <two@x.edu> <three@x.edu>" },
        ],
      }),
    );
    expect(result.references).toEqual(["one@x.edu", "two@x.edu", "three@x.edu"]);
  });

  // Keeping the tail rather than the head: the nearest ancestors are the ones
  // most likely to match a message we already stored.
  it("keeps the most recent references when the thread overruns the cap", () => {
    const ids = Array.from(
      { length: inboundEmailLimits.references + 5 },
      (_, index) => `<id-${index}@x.edu>`,
    );
    const result = mapAndParse(
      payload({ Headers: [{ Name: "References", Value: ids.join(" ") }] }),
    );

    expect(result.references).toHaveLength(inboundEmailLimits.references);
    expect(result.references?.at(-1)).toBe(
      `id-${inboundEmailLimits.references + 4}@x.edu`,
    );
  });

  it("drops an empty Message-Id rather than storing a blank unique id", () => {
    const result = mapAndParse(
      payload({ Headers: [{ Name: "Message-ID", Value: "<>" }], MessageID: "" }),
    );
    expect(result.messageId).toBeUndefined();
  });
});
