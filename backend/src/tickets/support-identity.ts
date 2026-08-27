// The helpdesk's own email identity — the From on anything we send, the
// attribution stored on a reply the auto-resolve worker wrote (no member of
// staff wrote it, so its `sentById` stays null), and the domain the outbound
// Message-Ids are minted in.
//
// One address deliberately serves all three: it is the address the student
// actually sees, so the thread's attribution and the ids we mint should agree
// with it rather than drift from it.
//
// `POSTMARK_FROM_EMAIL` takes precedence because it names the constraint that
// really binds — the address must be covered by a verified Postmark sender
// signature, or Postmark refuses the send. `SUPPORT_EMAIL` remains as the
// fallback.
//
// Read per call rather than at import so a deployment can retune it with a
// restart, and so tests can set it without reloading the module.
export function supportIdentity(): { email: string; name: string } {
  return {
    email:
      process.env.POSTMARK_FROM_EMAIL?.trim() ||
      process.env.SUPPORT_EMAIL?.trim() ||
      "support@example.com",
    name: process.env.SUPPORT_NAME?.trim() || "Support",
  };
}

/**
 * The Postmark **inbound** address — where a student's reply has to land for it
 * to become part of the ticket. Set as Reply-To on everything we send.
 *
 * This is deliberately *not* the From address. The From must be a verified
 * sender signature, and such an address is typically a human mailbox or a
 * forwarding alias: replying to it delivers the mail to a person's inbox and the
 * helpdesk never sees it, so the thread silently dies. Postmark's inbound
 * address is the only one guaranteed to reach the webhook.
 *
 * Found in Postmark under Servers → your server → Settings → Inbound, or via
 * `GET /server` as `InboundAddress`. It looks like
 * `<hash>@inbound.postmarkapp.com` unless a custom inbound domain is set.
 */
export function inboundReplyToAddress(): string | undefined {
  return process.env.POSTMARK_INBOUND_ADDRESS?.trim() || undefined;
}
