import { beforeEach, describe, expect, it, mock } from "bun:test";

// Only the Prisma singleton is stubbed. ai-agent.ts reads through the same
// singleton, so `aiUser` below decides whether the AI agent looks seeded —
// exercising the real lookup, cache and all, rather than mocking it out.
type Call = { where?: Record<string, unknown>; data?: Record<string, unknown> };

let aiUser: { id: string } | null = { id: "ai-user-1" };
let parentTicketId: number | null = null;
let dedupedTicketId: number | null = null;

let ticketUpdateManyCalls: Call[] = [];
let ticketCreateCalls: Call[] = [];
let messageCreateCalls: Call[] = [];
let userFindFirstCalls: Call[] = [];

mock.module("../prisma.ts", () => ({
  prisma: {
    user: {
      findFirst: async (args: Call) => {
        userFindFirstCalls.push(args);
        return aiUser;
      },
    },
    message: {
      findUnique: async () =>
        dedupedTicketId === null ? null : { ticketId: dedupedTicketId },
      findFirst: async () =>
        parentTicketId === null ? null : { ticketId: parentTicketId },
      create: async (args: Call) => {
        messageCreateCalls.push(args);
        return { id: 1 };
      },
    },
    ticket: {
      create: async (args: Call) => {
        ticketCreateCalls.push(args);
        return { id: 42 };
      },
      updateMany: async (args: Call) => {
        ticketUpdateManyCalls.push(args);
        return { count: 1 };
      },
    },
    // The array form: each updateMany in the array has already been invoked by
    // the time this runs, so the calls are recorded either way.
    $transaction: async (operations: Promise<unknown>[]) =>
      Promise.all(operations),
  },
}));

const { ingestInboundEmail } = await import("./ingest-inbound-email.ts");
const { resetAiAgentCache } = await import("./ai-agent.ts");

const email = {
  fromEmail: "student@students.edu",
  fromName: "Ada Student",
  subject: "Cannot log in",
  body: "My password reset link expired.",
};

// Threading is only attempted for an email that references an earlier one, so a
// reply needs inReplyTo — without it the parent lookup never runs and this
// arrives as a brand-new ticket.
const reply = { ...email, inReplyTo: "<parent@mail.example.com>" };

beforeEach(() => {
  aiUser = { id: "ai-user-1" };
  parentTicketId = null;
  dedupedTicketId = null;
  ticketUpdateManyCalls = [];
  ticketCreateCalls = [];
  messageCreateCalls = [];
  userFindFirstCalls = [];
  // The id is cached for the life of the process otherwise, so a test that wants
  // the AI missing would still see the previous test's hit.
  resetAiAgentCache();
});

describe("a new ticket", () => {
  // The status says the auto-resolve worker owns it, so the assignee has to
  // agree — otherwise the ticket claims a model is working on it while showing
  // that nobody is.
  it("is assigned to the AI agent on arrival", async () => {
    expect(await ingestInboundEmail(email)).toEqual({
      ticketId: 42,
      status: "created",
    });
    expect(ticketCreateCalls[0]?.data).toMatchObject({
      status: "new",
      assignedToId: "ai-user-1",
    });
  });

  it("looks the AI agent up by email, ignoring soft-deleted rows", async () => {
    await ingestInboundEmail(email);

    expect(userFindFirstCalls[0]?.where).toEqual({
      email: "ai@helpdesk.local",
      deletedAt: null,
    });
  });

  // A missing AI user must degrade to the pre-feature behaviour, not break
  // intake: throwing here would 5xx the mail provider and turn one unseeded row
  // into a redelivery loop on every incoming email.
  it("still arrives, unassigned, when the AI agent has not been seeded", async () => {
    aiUser = null;
    const warn = console.warn;
    console.warn = () => {};

    try {
      expect(await ingestInboundEmail(email)).toEqual({
        ticketId: 42,
        status: "created",
      });
    } finally {
      console.warn = warn;
    }

    expect(ticketCreateCalls[0]?.data).toMatchObject({
      status: "new",
      assignedToId: null,
    });
  });
});

describe("a student's reply", () => {
  it("reopens a resolved ticket and clears its resolution time", async () => {
    parentTicketId = 7;

    expect(await ingestInboundEmail(reply)).toEqual({
      ticketId: 7,
      status: "threaded",
    });
    expect(ticketUpdateManyCalls[0]).toEqual({
      where: { id: 7, status: { in: ["resolved", "closed"] } },
      data: { status: "open", resolvedAt: null },
    });
  });

  // The reopen fires for agent-resolved tickets too, so the release is scoped to
  // the AI's id — clearing it unconditionally would take an agent's own thread
  // away from them.
  it("releases only the AI's grip, not an agent's", async () => {
    parentTicketId = 7;

    await ingestInboundEmail(reply);

    expect(ticketUpdateManyCalls[1]).toEqual({
      where: { id: 7, assignedToId: "ai-user-1", status: "open" },
      data: { assignedToId: null },
    });
  });

  // Without the status condition, a follow-up email arriving while the ticket is
  // still `new`/`processing` would pull the assignment out from under the worker
  // mid-call.
  it("scopes the release to a ticket it actually reopened", async () => {
    parentTicketId = 7;

    await ingestInboundEmail(reply);

    expect(ticketUpdateManyCalls[1]?.where).toMatchObject({ status: "open" });
  });

  it("skips the release entirely when there is no AI agent", async () => {
    parentTicketId = 7;
    aiUser = null;
    const warn = console.warn;
    console.warn = () => {};

    try {
      await ingestInboundEmail(reply);
    } finally {
      console.warn = warn;
    }

    expect(ticketUpdateManyCalls).toHaveLength(1);
  });

  it("appends the reply to the existing thread", async () => {
    parentTicketId = 7;

    await ingestInboundEmail(reply);

    expect(messageCreateCalls[0]?.data).toMatchObject({
      ticketId: 7,
      direction: "inbound",
    });
  });
});

describe("a duplicate delivery", () => {
  // A provider retry of an email already stored changes nothing, so it must not
  // touch the assignment or the resolution time.
  it("changes nothing", async () => {
    dedupedTicketId = 7;

    expect(
      await ingestInboundEmail({ ...email, messageId: "<abc@mail>" }),
    ).toEqual({ ticketId: 7, status: "deduped" });
    expect(ticketUpdateManyCalls).toHaveLength(0);
    expect(ticketCreateCalls).toHaveLength(0);
    expect(messageCreateCalls).toHaveLength(0);
  });
});
