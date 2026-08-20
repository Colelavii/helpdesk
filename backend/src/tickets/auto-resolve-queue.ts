import type { Job } from "pg-boss";
import { boss } from "../queue.ts";
import { autoResolveTicket, skipAutoResolve } from "./auto-resolve-ticket.ts";
import { MissingAutoResolveApiKeyError } from "./resolve-ticket.ts";
import { MissingKnowledgeBaseError } from "./knowledge-base.ts";
import type { IngestResult } from "./ingest-inbound-email.ts";

export const autoResolveQueue = "ticket-auto-resolve";
// Jobs that fail every retry are copied here instead of disappearing, so a
// systematic failure is inspectable in the database and not just in the logs.
export const autoResolveDeadLetterQueue = "ticket-auto-resolve-failed";

export interface TicketAutoResolveJob {
  ticketId: number;
}

export async function createAutoResolveQueues(): Promise<void> {
  await boss.createQueue(autoResolveDeadLetterQueue);
  await boss.createQueue(autoResolveQueue, {
    deadLetter: autoResolveDeadLetterQueue,
    // Model calls fail transiently — rate limits, brief upstream outages — so
    // back off rather than retrying straight into the wall. Fewer attempts than
    // classification: every retry keeps a student waiting on a reply, and a
    // ticket that runs out of attempts still reaches an agent as `open`.
    retryLimit: 3,
    retryDelay: 10,
    retryBackoff: true,
    // Generous next to classification's 120s: this is Sonnet with adaptive
    // thinking writing a full reply, not Haiku returning one word.
    expireInSeconds: 300,
  });
}

// A throw fails the whole batch, so jobs are fetched one at a time — one poison
// ticket then can't drag healthy ones through its retries with it.
const workOptions = { batchSize: 1 };

export async function handleAutoResolveJobs(
  jobs: Job<TicketAutoResolveJob>[],
): Promise<void> {
  for (const job of jobs) {
    const { ticketId } = job.data;
    try {
      await autoResolveTicket(ticketId);
    } catch (error) {
      // A missing key or an unreadable knowledge base is configuration, not a
      // transient fault — retrying can't fix either, so the job completes.
      // autoResolveTicket has already moved the ticket to `open`, so an agent
      // picks it up rather than it sitting invisible.
      if (
        error instanceof MissingAutoResolveApiKeyError ||
        error instanceof MissingKnowledgeBaseError
      ) {
        console.warn(
          `Skipping auto-resolve for ticket ${ticketId}: ${error.message}`,
        );
        continue;
      }
      // Anything else is worth another attempt: pg-boss retries with backoff and
      // dead-letters the job once the attempts run out.
      throw error;
    }
  }
}

export async function registerAutoResolveWorker(): Promise<void> {
  await createAutoResolveQueues();
  await boss.work<TicketAutoResolveJob>(
    autoResolveQueue,
    workOptions,
    handleAutoResolveJobs,
  );
}

// Off only when explicitly disabled, so a deployment that never sets the var
// still gets the feature.
function autoResolveEnabled(): boolean {
  return process.env.AUTO_RESOLVE_ENABLED?.trim().toLowerCase() !== "false";
}

// Hands auto-resolution to the queue instead of running it in the web process:
// the job outlives a crash or deploy, gets retried on failure, and can be worked
// by a separate process later without touching the webhook.
//
// Unlike enqueueTicketClassification this never rejects, and it owns what
// happens when there will be no job. A ticket is created as `new`, which the
// ticket list hides — so if nothing is going to move it on, something has to,
// or the ticket is invisible to every agent. That is what skipAutoResolve is
// for, and why the caller has no catch of its own.
export async function scheduleTicketAutoResolve(
  result: IngestResult,
): Promise<void> {
  // Only a brand-new ticket is a candidate. A reply threaded onto an existing
  // ticket is part of a conversation an agent is already in, and a deduped
  // provider retry was handled by the delivery it duplicates.
  if (result.status !== "created") return;

  if (!autoResolveEnabled()) {
    await release(result.ticketId, "auto-resolve is disabled");
    return;
  }

  try {
    await boss.send(autoResolveQueue, {
      ticketId: result.ticketId,
    } satisfies TicketAutoResolveJob);
  } catch (error) {
    console.error(
      `Failed to enqueue auto-resolve for ticket ${result.ticketId}`,
      error,
    );
    await release(result.ticketId, "the job could not be enqueued");
  }
}

async function release(ticketId: number, why: string): Promise<void> {
  try {
    await skipAutoResolve(ticketId);
  } catch (error) {
    // Both callers are already on a degraded path; the ticket itself is stored,
    // and an admin can move it on by hand from its direct URL.
    console.error(
      `Ticket ${ticketId} is stuck awaiting auto-resolve (${why}) and could not be handed to agents`,
      error,
    );
  }
}
