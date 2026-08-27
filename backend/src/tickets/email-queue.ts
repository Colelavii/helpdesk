import type { Job } from "pg-boss";
import { boss } from "../queue.ts";
import { prisma } from "../prisma.ts";
import {
  MissingPostmarkTokenError,
  UndeliverableEmailError,
  sendTicketEmail,
} from "./send-email.ts";

export const emailSendQueue = "email-send";
// Jobs that fail every retry are copied here instead of disappearing, so a
// systematic failure is inspectable in the database and not just in the logs.
export const emailSendDeadLetterQueue = "email-send-failed";

export interface EmailSendJob {
  // The Message row's primary key — deliberately not the RFC Message-Id, which
  // is a string. The row is the single source of truth for what to send, so the
  // job carries no copy of the body that could go stale.
  messageRowId: number;
}

export async function createEmailSendQueues(): Promise<void> {
  await boss.createQueue(emailSendDeadLetterQueue);
  await boss.createQueue(emailSendQueue, {
    deadLetter: emailSendDeadLetterQueue,
    // More attempts than the model queues get: this is a reply a student is
    // waiting on, the work is one cheap HTTP call, and the usual failures
    // (rate limit, brief outage) clear on their own.
    retryLimit: 5,
    retryDelay: 15,
    retryBackoff: true,
    // One API round-trip. Anything beyond a minute is hung, not slow.
    expireInSeconds: 60,
  });
}

// A throw fails the whole batch, so jobs are fetched one at a time — one poison
// message then can't drag healthy ones through its retries with it.
const workOptions = { batchSize: 1 };

export async function handleEmailSendJobs(
  jobs: Job<EmailSendJob>[],
): Promise<void> {
  for (const job of jobs) {
    const { messageRowId } = job.data;

    const message = await prisma.message.findUnique({
      where: { id: messageRowId },
      select: {
        id: true,
        direction: true,
        fromName: true,
        body: true,
        messageId: true,
        inReplyTo: true,
        references: true,
        sentAt: true,
        ticket: {
          select: { subject: true, requesterEmail: true, requesterName: true },
        },
      },
    });

    // The ticket was deleted (messages cascade with it) between enqueue and
    // now. There is nothing to send and never will be.
    if (!message) {
      console.warn(`Skipping email send: message ${messageRowId} no longer exists`);
      continue;
    }
    // Defensive: nothing enqueues inbound messages, and sending a student's own
    // mail back to them would be worse than dropping the job.
    if (message.direction !== "outbound") {
      console.warn(`Skipping email send: message ${messageRowId} is inbound`);
      continue;
    }
    // Already delivered, so there is nothing to do. This covers a job that was
    // redelivered *after* the write below committed — the process died or the
    // job expired before pg-boss could mark it complete — and a second
    // enqueue for the same row.
    //
    // ⚠️ It does NOT make delivery exactly-once. If Postmark accepts the send
    // and the write below fails, sentAt stays null and the retry sends a second
    // copy; the same is true of a crash in between. Postmark's /email has no
    // idempotency key, so there is nothing cheap to close that window with.
    // Delivery is at-least-once, and duplicates are rare but possible.
    if (message.sentAt) continue;

    try {
      await sendTicketEmail({
        to: message.ticket.requesterEmail,
        toName: message.ticket.requesterName,
        subject: message.ticket.subject,
        body: message.body,
        fromName: message.fromName,
        messageId: message.messageId ?? undefined,
        inReplyTo: message.inReplyTo ?? undefined,
        references: message.references,
      });

      // The send has already happened by this point, so a failure here is the
      // at-least-once window described above: it is reported as transient and
      // retried, which re-sends. Recording the send is what makes every
      // *later* redelivery a no-op, so it is worth retrying even at that cost.
      await prisma.message.update({
        where: { id: message.id },
        // Clears any error from an earlier attempt: the message did go out, and
        // a stale failure on the thread would say otherwise.
        data: { sentAt: new Date(), deliveryError: null },
      });
    } catch (error) {
      // Neither a missing token nor a rejected payload improves by being tried
      // again, so both complete the job. The failure is recorded on the message,
      // which is what puts it in front of an agent on the ticket instead of
      // leaving it buried in a log.
      if (error instanceof MissingPostmarkTokenError) {
        console.warn(
          `Not sending message ${message.id}: POSTMARK_SERVER_TOKEN is not configured`,
        );
        await recordDeliveryFailure(
          message.id,
          "Email sending is not configured, so this reply was not delivered.",
        );
        continue;
      }
      if (error instanceof UndeliverableEmailError) {
        console.error(
          `Postmark rejected message ${message.id} (code ${error.code})`,
          error.message,
        );
        await recordDeliveryFailure(
          message.id,
          `Postmark rejected this reply: ${error.message}`,
        );
        continue;
      }

      // Transient. Record what happened for whoever looks at the ticket in the
      // meantime, then rethrow so pg-boss retries with backoff and eventually
      // dead-letters the job. A later success clears the message again.
      await recordDeliveryFailure(
        message.id,
        "Sending this reply failed and will be retried.",
      );
      throw error;
    }
  }
}

export async function registerEmailSendWorker(): Promise<void> {
  await createEmailSendQueues();
  await boss.work<EmailSendJob>(
    emailSendQueue,
    workOptions,
    handleEmailSendJobs,
  );
}

/**
 * Hands an outbound message to the send queue. Never throws: the message row is
 * already committed, and a reply that is stored but unqueued must not turn an
 * otherwise successful request into an error. A queue that refused the job is
 * recorded on the message instead, so the thread shows it never left.
 */
export async function enqueueEmailSend(messageRowId: number): Promise<void> {
  try {
    await boss.send(emailSendQueue, { messageRowId } satisfies EmailSendJob);
  } catch (error) {
    console.error(`Failed to enqueue email send for message ${messageRowId}`, error);
    await recordDeliveryFailure(
      messageRowId,
      "This reply could not be queued for sending.",
    );
  }
}

async function recordDeliveryFailure(
  messageRowId: number,
  reason: string,
): Promise<void> {
  try {
    await prisma.message.update({
      where: { id: messageRowId },
      data: { deliveryError: reason },
    });
  } catch (error) {
    // Best-effort: the caller is already on a failure path, and losing the
    // annotation must not mask the original problem or fail the job twice over.
    console.error(
      `Could not record the delivery failure on message ${messageRowId}`,
      error,
    );
  }
}
