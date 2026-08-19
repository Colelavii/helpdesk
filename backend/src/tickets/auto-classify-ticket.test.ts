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

const { autoClassifyTicket } = await import("./auto-classify-ticket.ts");

const originalApiKey = process.env.ANTHROPIC_API_KEY;

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

  // The queue worker turns a rejection into a retry, so a transient model
  // failure has to propagate rather than resolve quietly.
  it("propagates a failed model call", async () => {
    createError = new Error("upstream is down");

    await expect(autoClassifyTicket(7)).rejects.toThrow("upstream is down");
    expect(updateManyArgs).toHaveLength(0);
  });
});
