import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import type { Job } from "pg-boss";
import { MissingClassificationApiKeyError } from "./classify-ticket.ts";
// Type-only, so it's erased and doesn't load the real module before the mocks.
import type { TicketClassificationJob } from "./classification-queue.ts";

// The pg-boss instance is stubbed so nothing here needs a database, and
// autoClassifyTicket is stubbed so the worker's own error handling is what's
// under test rather than the classify → persist path (covered in its own spec).
type SendCall = { name: string; data: object | null | undefined };
type QueueCall = { name: string; options?: Record<string, unknown> };
type WorkCall = { name: string; options: Record<string, unknown> };

let sendCalls: SendCall[] = [];
let queueCalls: QueueCall[] = [];
let workCalls: WorkCall[] = [];

mock.module("../queue.ts", () => ({
  boss: {
    send: async (name: string, data?: object | null) => {
      sendCalls.push({ name, data });
      return "job-id";
    },
    createQueue: async (name: string, options?: Record<string, unknown>) => {
      queueCalls.push({ name, options });
    },
    work: async (
      name: string,
      options: Record<string, unknown>,
      _handler: unknown,
    ) => {
      workCalls.push({ name, options });
      return "work-id";
    },
  },
}));

let classified: number[] = [];
let classifyError: Error | null = null;

mock.module("./auto-classify-ticket.ts", () => ({
  autoClassifyTicket: async (ticketId: number) => {
    classified.push(ticketId);
    if (classifyError) throw classifyError;
    return { status: "classified" };
  },
}));

const {
  classificationQueue,
  classificationDeadLetterQueue,
  enqueueTicketClassification,
  handleClassificationJobs,
  registerClassificationWorker,
} = await import("./classification-queue.ts");

function job(ticketId: number): Job<TicketClassificationJob> {
  // Only `data` is read by the handler; the rest of pg-boss's job envelope is
  // filled in to satisfy the type.
  return {
    id: `job-${ticketId}`,
    name: classificationQueue,
    data: { ticketId },
  } as Job<TicketClassificationJob>;
}

beforeEach(() => {
  sendCalls = [];
  queueCalls = [];
  workCalls = [];
  classified = [];
  classifyError = null;
});

describe("enqueueTicketClassification", () => {
  it("sends a job carrying the new ticket's id", async () => {
    const jobId = await enqueueTicketClassification({
      ticketId: 7,
      status: "created",
    });

    expect(jobId).toBe("job-id");
    expect(sendCalls).toEqual([
      { name: classificationQueue, data: { ticketId: 7 } },
    ]);
  });

  // A reply keeps its ticket's existing category, and a deduped retry was
  // handled by the delivery it duplicates — neither is worth a job.
  it("enqueues nothing for a threaded reply", async () => {
    expect(
      await enqueueTicketClassification({ ticketId: 7, status: "threaded" }),
    ).toBeNull();
    expect(sendCalls).toHaveLength(0);
  });

  it("enqueues nothing for a deduped delivery", async () => {
    expect(
      await enqueueTicketClassification({ ticketId: 7, status: "deduped" }),
    ).toBeNull();
    expect(sendCalls).toHaveLength(0);
  });
});

describe("registerClassificationWorker", () => {
  it("creates the dead letter queue before the queue that references it", async () => {
    await registerClassificationWorker();

    expect(queueCalls.map((call) => call.name)).toEqual([
      classificationDeadLetterQueue,
      classificationQueue,
    ]);
  });

  it("configures backing-off retries and a dead letter queue", async () => {
    await registerClassificationWorker();

    expect(queueCalls[1]?.options).toMatchObject({
      deadLetter: classificationDeadLetterQueue,
      retryLimit: 4,
      retryBackoff: true,
      expireInSeconds: 120,
    });
  });

  // A throw fails the whole batch, so one job per fetch keeps a failing ticket
  // from dragging healthy ones through its retries.
  it("works one job at a time", async () => {
    await registerClassificationWorker();

    expect(workCalls).toEqual([
      { name: classificationQueue, options: { batchSize: 1 } },
    ]);
  });
});

describe("handleClassificationJobs", () => {
  it("classifies the ticket named in the job", async () => {
    await handleClassificationJobs([job(7)]);

    expect(classified).toEqual([7]);
  });

  it("handles every job in a batch", async () => {
    await handleClassificationJobs([job(7), job(8)]);

    expect(classified).toEqual([7, 8]);
  });

  // Rejecting is how the worker asks pg-boss for a retry, so a transient
  // failure must not be swallowed here.
  it("rethrows a transient failure so the job is retried", async () => {
    classifyError = new Error("upstream is down");

    await expect(handleClassificationJobs([job(7)])).rejects.toThrow(
      "upstream is down",
    );
  });

  // Retrying cannot conjure an API key, so the job completes instead of
  // burning its attempts and landing in the dead letter queue.
  it("completes the job when no API key is configured", async () => {
    classifyError = new MissingClassificationApiKeyError();
    const warnings: unknown[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(args);

    try {
      await handleClassificationJobs([job(7)]);
    } finally {
      console.warn = originalWarn;
    }

    expect(warnings).toHaveLength(1);
  });
});
