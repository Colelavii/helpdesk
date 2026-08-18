import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";

// Both the SDK and the Prisma singleton are stubbed before the module under test
// is imported: this exercises the real classify → persist path with no network
// and no database. The SDK stub mirrors the one in classify-ticket.test.ts.
let completion = '{"category": "technical"}';
let createError: Error | null = null;
let createCalls = 0;

mock.module("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      create: async () => {
        createCalls += 1;
        if (createError) throw createError;
        return { content: [{ type: "text", text: completion }] };
      },
    };
  },
}));

type TicketRow = {
  subject: string;
  category: string | null;
  messages: { body: string }[];
};

let ticket: TicketRow | null = null;
let updateCount = 1;
let findUniqueArgs: { where: { id: number } }[] = [];
let updateManyArgs: {
  where: { id: number; category: null };
  data: { category: string };
}[] = [];

mock.module("../prisma.ts", () => ({
  prisma: {
    ticket: {
      findUnique: async (args: { where: { id: number } }) => {
        findUniqueArgs.push(args);
        return ticket;
      },
      updateMany: async (args: {
        where: { id: number; category: null };
        data: { category: string };
      }) => {
        updateManyArgs.push(args);
        return { count: updateCount };
      },
    },
  },
}));

const { autoClassifyTicket, classifyTicketInBackground } = await import(
  "./auto-classify-ticket.ts"
);

const originalApiKey = process.env.ANTHROPIC_API_KEY;

// Lets a fire-and-forget promise chain settle without exposing it to callers.
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  completion = '{"category": "technical"}';
  createError = null;
  createCalls = 0;
  updateCount = 1;
  findUniqueArgs = [];
  updateManyArgs = [];
  ticket = {
    subject: "Cannot access the portal",
    category: null,
    messages: [{ body: "I can't log in." }],
  };
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";
});

afterEach(() => {
  if (originalApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = originalApiKey;
});

describe("autoClassifyTicket", () => {
  it("stores the category the model chose", async () => {
    completion = '{"category": "refund"}';

    expect(await autoClassifyTicket(7)).toEqual({ status: "classified" });
    expect(findUniqueArgs[0]?.where).toEqual({ id: 7 });
    expect(updateManyArgs[0]?.data).toEqual({ category: "refund" });
  });

  // The filter is what stops the model overwriting an agent who categorised the
  // ticket by hand while the call was in flight.
  it("only writes while the category is still unset", async () => {
    await autoClassifyTicket(7);

    expect(updateManyArgs[0]?.where).toEqual({ id: 7, category: null });
  });

  it("reports a write that lost the race", async () => {
    updateCount = 0;

    expect(await autoClassifyTicket(7)).toEqual({ status: "superseded" });
  });

  it("skips a ticket that already has a category", async () => {
    ticket = { ...ticket!, category: "general" };

    expect(await autoClassifyTicket(7)).toEqual({ status: "skipped" });
    expect(createCalls).toBe(0);
    expect(updateManyArgs).toHaveLength(0);
  });

  it("skips a ticket that no longer exists", async () => {
    ticket = null;

    expect(await autoClassifyTicket(7)).toEqual({ status: "skipped" });
    expect(createCalls).toBe(0);
  });

  // A webhook payload may carry no body at all; that's a "general" ticket, not a
  // crash.
  it("classifies a ticket with no messages", async () => {
    ticket = { ...ticket!, messages: [] };

    expect(await autoClassifyTicket(7)).toEqual({ status: "classified" });
    expect(createCalls).toBe(1);
  });
});

describe("classifyTicketInBackground", () => {
  const created = { ticketId: 7, status: "created" } as const;

  it("returns before the classification finishes", () => {
    expect(classifyTicketInBackground(created)).toBeUndefined();
    expect(updateManyArgs).toHaveLength(0);
  });

  it("still stores the category once the call completes", async () => {
    classifyTicketInBackground(created);

    await settle();

    expect(updateManyArgs[0]?.data).toEqual({ category: "technical" });
  });

  // A reply on an existing ticket keeps that ticket's category, and a deduped
  // retry was handled by the delivery it duplicates — neither reaches the model.
  it("ignores a threaded reply", async () => {
    classifyTicketInBackground({ ticketId: 7, status: "threaded" });

    await settle();

    expect(findUniqueArgs).toHaveLength(0);
    expect(createCalls).toBe(0);
  });

  it("ignores a deduped delivery", async () => {
    classifyTicketInBackground({ ticketId: 7, status: "deduped" });

    await settle();

    expect(findUniqueArgs).toHaveLength(0);
    expect(createCalls).toBe(0);
  });

  // A model outage must not surface as an unhandled rejection — the webhook has
  // already answered, and the ticket is stored either way.
  it("swallows a failed model call", async () => {
    createError = new Error("upstream is down");
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errors.push(args);

    try {
      classifyTicketInBackground(created);
      await settle();
    } finally {
      console.error = original;
    }

    expect(errors).toHaveLength(1);
    expect(updateManyArgs).toHaveLength(0);
  });

  it("warns rather than errors when no API key is configured", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const warnings: unknown[] = [];
    const originalWarn = console.warn;
    const originalError = console.error;
    const errors: unknown[] = [];
    console.warn = (...args: unknown[]) => warnings.push(args);
    console.error = (...args: unknown[]) => errors.push(args);

    try {
      classifyTicketInBackground(created);
      await settle();
    } finally {
      console.warn = originalWarn;
      console.error = originalError;
    }

    expect(warnings).toHaveLength(1);
    expect(errors).toHaveLength(0);
  });
});
