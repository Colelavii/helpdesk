import type { Job } from "pg-boss";
import { boss } from "../queue.ts";
import { autoClassifyTicket } from "./auto-classify-ticket.ts";
import { MissingClassificationApiKeyError } from "./classify-ticket.ts";
import type { IngestResult } from "./ingest-inbound-email.ts";

export const classificationQueue = "ticket-classification";
// Jobs that fail every retry are copied here instead of disappearing, so a
// systematic failure is inspectable in the database and not just in the logs.
export const classificationDeadLetterQueue = "ticket-classification-failed";

export interface TicketClassificationJob {
  ticketId: number;
}

export async function createClassificationQueues(): Promise<void> {
  await boss.createQueue(classificationDeadLetterQueue);
  await boss.createQueue(classificationQueue, {
    deadLetter: classificationDeadLetterQueue,
    // Model calls fail transiently — rate limits, brief upstream outages — so
    // back off across a few minutes rather than retrying straight into the wall.
    retryLimit: 4,
    retryDelay: 5,
    retryBackoff: true,
    // Comfortably above a normal Haiku round-trip, but far below pg-boss's
    // 15-minute default: a hung request should be retried in minutes.
    expireInSeconds: 120,
  });
}

// A throw fails the whole batch, so jobs are fetched one at a time — one poison
// ticket then can't drag healthy ones through its retries with it.
const workOptions = { batchSize: 1 };

export async function handleClassificationJobs(
  jobs: Job<TicketClassificationJob>[],
): Promise<void> {
  for (const job of jobs) {
    const { ticketId } = job.data;
    try {
      await autoClassifyTicket(ticketId);
    } catch (error) {
      // A missing key is configuration, not a transient fault — retrying can't
      // conjure one, so the job completes and the ticket stays uncategorised for
      // an agent to set.
      if (error instanceof MissingClassificationApiKeyError) {
        console.warn(
          `Skipping classification for ticket ${ticketId}: ANTHROPIC_API_KEY is not configured`,
        );
        continue;
      }
      // Anything else is worth another attempt: pg-boss retries with backoff and
      // dead-letters the job once the attempts run out.
      throw error;
    }
  }
}

export async function registerClassificationWorker(): Promise<void> {
  await createClassificationQueues();
  await boss.work<TicketClassificationJob>(
    classificationQueue,
    workOptions,
    handleClassificationJobs,
  );
}

// Hands classification to the queue instead of running it in the web process:
// the job outlives a crash or deploy, gets retried on failure, and can be worked
// by a separate process later without touching the webhook.
export async function enqueueTicketClassification(
  result: IngestResult,
): Promise<string | null> {
  // Only a brand-new ticket needs a category. A reply threaded onto an existing
  // ticket keeps that ticket's category, and a deduped provider retry was
  // handled by the delivery it duplicates.
  if (result.status !== "created") return null;

  return boss.send(classificationQueue, {
    ticketId: result.ticketId,
  } satisfies TicketClassificationJob);
}
