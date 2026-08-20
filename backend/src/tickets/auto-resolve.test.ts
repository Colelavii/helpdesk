import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Job } from "pg-boss";
// Type-only, so they're erased and don't load the real modules before the mocks.
import type { ResolutionContext } from "./resolve-ticket.ts";
import type { TicketAutoResolveJob } from "./auto-resolve-queue.ts";

// The whole auto-resolve feature lives in one spec on purpose. Bun hoists every
// mock.module registration before any file runs, so two spec files cannot hold
// different stubs of the same module: whichever loads first binds it for both.
// Splitting these by module would mean mocking resolve-ticket.ts and
// auto-resolve-ticket.ts, which would then leak into each other's spec.
//
// So nothing first-party is mocked here — only the three leaf boundaries, which
// no spec tests directly. Every module in the chain runs for real, and the model
// call is steered by what the stubbed SDK returns.

type SystemBlock = {
  type: string;
  text: string;
  cache_control?: { type: string };
};

type CreateParams = {
  model: string;
  max_tokens: number;
  thinking: { type: string };
  output_config: {
    effort: string;
    format: { type: string; schema: Record<string, unknown> };
  };
  system: SystemBlock[];
  messages: { role: string; content: string }[];
};

let calls: CreateParams[] = [];
let completion = "";
let createError: Error | null = null;

mock.module("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      create: async (params: CreateParams) => {
        calls.push(params);
        if (createError) throw createError;
        return { content: [{ type: "text", text: completion }] };
      },
    };
  },
}));

type Where = { id: number; status?: unknown };
type UpdateManyCall = { where: Where; data: Record<string, unknown> };
type MessageCall = { data: Record<string, unknown> };

type TicketRow = {
  status: string;
  subject: string;
  requesterName: string;
  messages: { body: string }[];
};

let ticket: TicketRow | null = null;
let updateManyCalls: UpdateManyCall[] = [];
let messageCalls: MessageCall[] = [];
// Both are consumed one per ticket.updateMany call, in order; anything past the
// end of a queue is a successful single-row update.
let updateManyCounts: number[] = [];
let updateManyErrors: (Error | null)[] = [];

function updateMany(args: UpdateManyCall): { count: number } {
  updateManyCalls.push(args);
  const error = updateManyErrors.shift();
  if (error) throw error;
  return { count: updateManyCounts.shift() ?? 1 };
}

const tx = {
  ticket: { updateMany: async (args: UpdateManyCall) => updateMany(args) },
  message: {
    create: async (args: MessageCall) => {
      messageCalls.push(args);
      return { id: 1 };
    },
  },
};

mock.module("../prisma.ts", () => ({
  prisma: {
    ticket: {
      findUnique: async () => ticket,
      updateMany: async (args: UpdateManyCall) => updateMany(args),
    },
    $transaction: async (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
  },
}));

type SendCall = { name: string; data: object | null | undefined };
type QueueCall = { name: string; options?: Record<string, unknown> };
type WorkCall = { name: string; options: Record<string, unknown> };

let sendCalls: SendCall[] = [];
let queueCalls: QueueCall[] = [];
let workCalls: WorkCall[] = [];
let sendError: Error | null = null;

mock.module("../queue.ts", () => ({
  boss: {
    send: async (name: string, data?: object | null) => {
      sendCalls.push({ name, data });
      if (sendError) throw sendError;
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

const { resolveTicket, MissingAutoResolveApiKeyError } = await import(
  "./resolve-ticket.ts"
);
const { autoResolveTicket, skipAutoResolve } = await import(
  "./auto-resolve-ticket.ts"
);
const {
  autoResolveQueue,
  autoResolveDeadLetterQueue,
  handleAutoResolveJobs,
  registerAutoResolveWorker,
  scheduleTicketAutoResolve,
} = await import("./auto-resolve-queue.ts");
const { resetKnowledgeBaseCache } = await import("./knowledge-base.ts");
const { TicketStatus } = await import("@helpdesk/core");

const originalEnv = {
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  AUTO_RESOLVE_CONFIDENCE_THRESHOLD:
    process.env.AUTO_RESOLVE_CONFIDENCE_THRESHOLD,
  AUTO_RESOLVE_ENABLED: process.env.AUTO_RESOLVE_ENABLED,
  KNOWLEDGE_BASE_PATH: process.env.KNOWLEDGE_BASE_PATH,
  SUPPORT_EMAIL: process.env.SUPPORT_EMAIL,
  SUPPORT_NAME: process.env.SUPPORT_NAME,
};

// The model's JSON answer. Tests override a field to steer the decision.
function decision(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    action: "resolve",
    confidence: 0.95,
    reason: "Section 1 covers password resets.",
    reply: "Hi Sam,\n\nClick Forgot Password.",
    ...overrides,
  });
}

function context(
  overrides: Partial<ResolutionContext> = {},
): ResolutionContext {
  return {
    subject: "I forgot my password",
    body: "I can't remember my password and want to get back in.",
    requesterName: "Sam Student",
    ...overrides,
  };
}

function ticketRow(overrides: Partial<TicketRow> = {}): TicketRow {
  return {
    status: TicketStatus.new,
    subject: "I forgot my password",
    requesterName: "Sam Student",
    messages: [{ body: "I can't remember my password." }],
    ...overrides,
  };
}

function job(ticketId: number): Job<TicketAutoResolveJob> {
  // Only `data` is read by the handler; the rest of pg-boss's job envelope is
  // filled in to satisfy the type.
  return {
    id: `job-${ticketId}`,
    name: autoResolveQueue,
    data: { ticketId },
  } as Job<TicketAutoResolveJob>;
}

function lastPrompt(): string {
  const call = calls.at(-1);
  if (!call) throw new Error("messages.create was never called");
  return call.messages[0]!.content;
}

function systemText(): string {
  const call = calls.at(-1);
  if (!call) throw new Error("messages.create was never called");
  return call.system.map((block) => block.text).join("\n");
}

// Points the loader at a file that does not exist, so the real
// MissingKnowledgeBaseError travels the real code path.
function breakKnowledgeBase(): void {
  process.env.KNOWLEDGE_BASE_PATH = join(tmpdir(), "helpdesk-no-such-kb.md");
  resetKnowledgeBaseCache();
}

function silence(stream: "warn" | "error"): () => void {
  const original = console[stream];
  console[stream] = () => {};
  return () => {
    console[stream] = original;
  };
}

function claimCall(): UpdateManyCall | undefined {
  return updateManyCalls[0];
}

function outcomeCall(): UpdateManyCall | undefined {
  return updateManyCalls[1];
}

beforeEach(() => {
  calls = [];
  completion = decision();
  createError = null;
  ticket = ticketRow();
  updateManyCalls = [];
  messageCalls = [];
  updateManyCounts = [];
  updateManyErrors = [];
  sendCalls = [];
  queueCalls = [];
  workCalls = [];
  sendError = null;

  process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";
  delete process.env.AUTO_RESOLVE_CONFIDENCE_THRESHOLD;
  delete process.env.AUTO_RESOLVE_ENABLED;
  delete process.env.KNOWLEDGE_BASE_PATH;
  delete process.env.SUPPORT_EMAIL;
  delete process.env.SUPPORT_NAME;
  // The loader caches, and breakKnowledgeBase() may have poisoned it.
  resetKnowledgeBaseCache();
});

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetKnowledgeBaseCache();
});

describe("resolveTicket", () => {
  describe("configuration", () => {
    it("throws MissingAutoResolveApiKeyError when no API key is set", async () => {
      delete process.env.ANTHROPIC_API_KEY;

      await expect(resolveTicket(context())).rejects.toBeInstanceOf(
        MissingAutoResolveApiKeyError,
      );
    });

    it("does not call the model when the key is missing", async () => {
      delete process.env.ANTHROPIC_API_KEY;

      await resolveTicket(context()).catch(() => {});

      expect(calls).toHaveLength(0);
    });

    it("treats an empty-string key as missing", async () => {
      process.env.ANTHROPIC_API_KEY = "";

      await expect(resolveTicket(context())).rejects.toBeInstanceOf(
        MissingAutoResolveApiKeyError,
      );
    });

    // Sonnet, not the Haiku classification uses: this writes the text a student
    // receives and has to judge whether to escalate at all.
    it("uses a model with room for thinking and a full reply", async () => {
      await resolveTicket(context());

      expect(calls[0]?.model).toBe("claude-sonnet-5");
      expect(calls[0]?.max_tokens).toBe(4096);
      expect(calls[0]?.thinking).toEqual({ type: "adaptive" });
      expect(calls[0]?.output_config.effort).toBe("medium");
    });

    it("constrains the response to a decision, a score, a reason and a reply", async () => {
      await resolveTicket(context());

      const { format } = calls[0]!.output_config;
      expect(format.type).toBe("json_schema");
      expect(format.schema).toMatchObject({
        type: "object",
        required: ["action", "confidence", "reason", "reply"],
        additionalProperties: false,
        properties: {
          action: { enum: ["resolve", "escalate"] },
          confidence: { type: "number" },
        },
      });
    });
  });

  describe("return value", () => {
    it("returns a resolution with its reply", async () => {
      completion = decision({ confidence: 0.91, reply: "Hi Sam," });

      expect(await resolveTicket(context())).toMatchObject({
        action: "resolve",
        confidence: 0.91,
        reply: "Hi Sam,",
      });
    });

    it("returns an escalation with no reply", async () => {
      completion = decision({
        action: "escalate",
        confidence: 0.2,
        reason: "Chargeback — escalation rule 10.",
        reply: "",
      });

      expect(await resolveTicket(context())).toMatchObject({
        action: "escalate",
        confidence: 0.2,
        reply: "",
      });
    });

    it("tolerates surrounding whitespace", async () => {
      completion = `\n  ${decision()}  \n`;

      expect((await resolveTicket(context())).action).toBe("resolve");
    });

    it("throws when the completion is not JSON", async () => {
      completion = "resolve";

      await expect(resolveTicket(context())).rejects.toThrow(
        "non-JSON resolution",
      );
    });

    it("throws on an action outside the two options", async () => {
      completion = decision({ action: "escalate_maybe" });

      await expect(resolveTicket(context())).rejects.toThrow(
        "unusable resolution",
      );
    });

    // Structured output can't express a numeric range, so this parse is the only
    // thing standing between a nonsense score and the confidence threshold.
    it.each([[95], [-0.1], ["high"]])(
      "throws on a confidence of %p",
      async (confidence) => {
        completion = decision({ confidence });

        await expect(resolveTicket(context())).rejects.toThrow(
          "unusable resolution",
        );
      },
    );

    // Resolving closes the ticket, so an empty reply would close it in silence —
    // the student would never hear back at all.
    it("throws when a resolve decision carries no reply", async () => {
      completion = decision({ reply: "   " });

      await expect(resolveTicket(context())).rejects.toThrow(
        "unusable resolution",
      );
    });

    it("throws on an empty completion", async () => {
      completion = "";

      await expect(resolveTicket(context())).rejects.toThrow(
        "non-JSON resolution",
      );
    });
  });

  describe("prompt contents", () => {
    it("includes the subject, the body, and the student's name", async () => {
      await resolveTicket(
        context({
          subject: "Refund please",
          body: "I bought the wrong course.",
          requesterName: "Dana Doe",
        }),
      );

      expect(lastPrompt()).toContain("Subject: Refund please");
      expect(lastPrompt()).toContain("I bought the wrong course.");
      expect(lastPrompt()).toContain("Student's name: Dana Doe");
    });

    it("marks a blank subject, body, and name rather than leaving them empty", async () => {
      await resolveTicket(
        context({ subject: " ", body: "", requesterName: " " }),
      );

      expect(lastPrompt()).toContain("Subject: (no subject)");
      expect(lastPrompt()).toContain("(empty)");
      expect(lastPrompt()).toContain("Student's name: unknown");
    });

    // The model must not answer as though it read text it never saw.
    it("truncates a very long body and says so", async () => {
      await resolveTicket(context({ body: "a".repeat(4_100) }));

      expect(lastPrompt()).toContain("a".repeat(4_000));
      expect(lastPrompt()).not.toContain("a".repeat(4_001));
      expect(lastPrompt()).toContain("the rest of the message is not shown");
    });

    it("leaves a body inside the limit intact", async () => {
      await resolveTicket(context({ body: "a".repeat(4_000) }));

      expect(lastPrompt()).not.toContain("the rest of the message is not shown");
    });
  });

  describe("system prompt", () => {
    // Against the real knowledge base, not a stand-in: the point of this call is
    // that the shipped support policy is what the model answers from.
    it("carries the repository's knowledge base", async () => {
      await resolveTicket(context());

      expect(systemText()).toContain("30-day money-back guarantee");
      expect(systemText()).toContain("Escalation Rules");
    });

    // The knowledge base is byte-identical on every job, so a breakpoint on the
    // last system block is what stops every ticket paying to re-read it.
    it("caches the knowledge base block", async () => {
      await resolveTicket(context());

      const blocks = calls[0]!.system;
      expect(blocks.at(-1)?.text).toContain("Knowledge base:");
      expect(blocks.at(-1)?.cache_control).toEqual({ type: "ephemeral" });
    });

    it("fails loudly when the knowledge base cannot be read", async () => {
      breakKnowledgeBase();

      await expect(resolveTicket(context())).rejects.toThrow(
        "Could not read the knowledge base",
      );
      expect(calls).toHaveLength(0);
    });

    it("allows only the two decisions", async () => {
      await resolveTicket(context());

      expect(systemText()).toContain('"resolve"');
      expect(systemText()).toContain('"escalate"');
    });

    it("defers to the knowledge base's own escalation rules", async () => {
      await resolveTicket(context());

      expect(systemText()).toContain("section 10 of the knowledge base");
      expect(systemText()).toContain("chargeback");
      expect(systemText()).toContain("legal action");
    });

    it("escalates rather than guessing at anything uncovered", async () => {
      await resolveTicket(context());

      expect(systemText()).toContain(
        "The knowledge base does not cover the question, or covers only part of it",
      );
      expect(systemText()).toContain("you are unsure for any other reason");
    });

    // A model that inflates its score to get a reply out defeats the threshold
    // entirely, so honesty about it is stated outright. The score is defined as
    // confidence in the *decision* so that a confident escalation isn't a
    // contradiction — only a "resolve" is ever gated on it.
    it("asks for an honest confidence score in the decision it made", async () => {
      await resolveTicket(context());

      expect(systemText()).toContain(
        '"confidence" is your 0–1 confidence in the decision you just made',
      );
      expect(systemText()).toContain("do not inflate it to get a reply sent");
    });

    it("forbids inventing policy or speaking to the student's own account", async () => {
      await resolveTicket(context());

      expect(systemText()).toContain(
        "Never invent a policy, timeframe, amount, URL, or step that is not written there",
      );
      expect(systemText()).toContain(
        "never state anything about this student's own account or order",
      );
    });

    it("specifies the greeting and sign-off the reply must use", async () => {
      await resolveTicket(context());

      expect(systemText()).toContain('Open with "Hi <first name>,"');
      expect(systemText()).toContain("The Code with Mosh Support Team");
    });
  });
});

describe("autoResolveTicket", () => {
  describe("claiming the ticket", () => {
    // The ticket has to leave `new` before the model call, or it would sit in
    // the agents' list for the whole of it.
    it("claims the ticket as processing before calling the model", async () => {
      await autoResolveTicket(7);

      expect(claimCall()?.data).toEqual({ status: TicketStatus.processing });
      expect(calls).toHaveLength(1);
    });

    // Accepting `processing` is what lets a retry re-claim a ticket whose worker
    // died mid-call, instead of leaving it stranded and invisible.
    it("claims from either new or processing", async () => {
      await autoResolveTicket(7);

      expect(claimCall()?.where).toEqual({
        id: 7,
        status: { in: [TicketStatus.new, TicketStatus.processing] },
      });
    });

    it("resumes a ticket left in processing by a dead worker", async () => {
      ticket = ticketRow({ status: TicketStatus.processing });

      expect(await autoResolveTicket(7)).toEqual({ status: "resolved" });
    });

    it("reports a claim that lost the race", async () => {
      updateManyCounts = [0];

      expect(await autoResolveTicket(7)).toEqual({ status: "superseded" });
      expect(calls).toHaveLength(0);
    });

    it("skips a ticket that no longer exists", async () => {
      ticket = null;

      expect(await autoResolveTicket(7)).toEqual({ status: "skipped" });
      expect(updateManyCalls).toHaveLength(0);
      expect(calls).toHaveLength(0);
    });

    it("skips a ticket an agent already moved on", async () => {
      ticket = ticketRow({ status: TicketStatus.open });

      expect(await autoResolveTicket(7)).toEqual({ status: "skipped" });
      expect(updateManyCalls).toHaveLength(0);
      expect(calls).toHaveLength(0);
    });

    it("passes the subject, first inbound body, and requester name to the model", async () => {
      await autoResolveTicket(7);

      expect(lastPrompt()).toContain("Subject: I forgot my password");
      expect(lastPrompt()).toContain("I can't remember my password.");
      expect(lastPrompt()).toContain("Student's name: Sam Student");
    });

    it("sends an empty body when the ticket has no inbound message", async () => {
      ticket = ticketRow({ messages: [] });

      await autoResolveTicket(7);

      expect(lastPrompt()).toContain("(empty)");
    });
  });

  describe("resolving", () => {
    it("resolves the ticket and records the decision", async () => {
      expect(await autoResolveTicket(7)).toEqual({ status: "resolved" });

      expect(outcomeCall()?.data).toMatchObject({
        status: TicketStatus.resolved,
        aiConfidence: 0.95,
        aiDecision: "Section 1 covers password resets.",
      });
      expect(outcomeCall()?.data.aiResolvedAt).toBeInstanceOf(Date);
    });

    it("writes the model's reply as an outbound message", async () => {
      await autoResolveTicket(7);

      expect(messageCalls[0]?.data).toMatchObject({
        ticketId: 7,
        direction: "outbound",
        body: "Hi Sam,\n\nClick Forgot Password.",
      });
    });

    // No member of staff wrote it, so it must not be attributed to one.
    it("attributes the reply to support rather than a user", async () => {
      await autoResolveTicket(7);

      expect(messageCalls[0]?.data).toMatchObject({
        fromEmail: "support@example.com",
        fromName: "Support",
      });
      expect(messageCalls[0]?.data.sentById).toBeUndefined();
    });

    it("uses the configured support identity", async () => {
      process.env.SUPPORT_EMAIL = "help@codewithmosh.test";
      process.env.SUPPORT_NAME = "Code with Mosh Support";

      await autoResolveTicket(7);

      expect(messageCalls[0]?.data).toMatchObject({
        fromEmail: "help@codewithmosh.test",
        fromName: "Code with Mosh Support",
      });
    });

    // The status update doubles as the guard, so an agent who grabbed the ticket
    // mid-call doesn't get a reply sent to their student behind their back.
    it("only resolves while the ticket is still processing", async () => {
      await autoResolveTicket(7);

      expect(outcomeCall()?.where).toEqual({
        id: 7,
        status: TicketStatus.processing,
      });
    });

    it("writes no message when an agent took the ticket mid-call", async () => {
      updateManyCounts = [1, 0];

      expect(await autoResolveTicket(7)).toEqual({ status: "superseded" });
      expect(messageCalls).toHaveLength(0);
    });
  });

  describe("escalating", () => {
    it("opens the ticket and records the reason", async () => {
      completion = decision({
        action: "escalate",
        confidence: 0.3,
        reason: "Chargeback — escalation rule 10.",
        reply: "",
      });

      expect(await autoResolveTicket(7)).toEqual({ status: "escalated" });
      expect(outcomeCall()?.data).toEqual({
        status: TicketStatus.open,
        aiConfidence: 0.3,
        aiDecision: "Chargeback — escalation rule 10.",
      });
      expect(messageCalls).toHaveLength(0);
    });

    it("leaves aiResolvedAt unset on an escalation", async () => {
      completion = decision({ action: "escalate", reply: "" });

      await autoResolveTicket(7);

      expect(outcomeCall()?.data.aiResolvedAt).toBeUndefined();
    });

    it("reports an escalation that lost the race", async () => {
      completion = decision({ action: "escalate", reply: "" });
      updateManyCounts = [1, 0];

      expect(await autoResolveTicket(7)).toEqual({ status: "superseded" });
    });
  });

  describe("the confidence threshold", () => {
    it("escalates a resolve that came in under the default threshold", async () => {
      completion = decision({ confidence: 0.79 });

      expect(await autoResolveTicket(7)).toEqual({ status: "escalated" });
      expect(messageCalls).toHaveLength(0);
    });

    it("resolves at exactly the threshold", async () => {
      completion = decision({ confidence: 0.8 });

      expect(await autoResolveTicket(7)).toEqual({ status: "resolved" });
    });

    // Otherwise the agent sees an escalation whose reason reads like a confident
    // answer, with no clue why nothing was sent.
    it("says the score was the reason it escalated", async () => {
      completion = decision({ confidence: 0.5 });

      await autoResolveTicket(7);

      expect(outcomeCall()?.data.aiDecision).toBe(
        "Confidence 0.5 is below the 0.8 threshold. Section 1 covers password resets.",
      );
    });

    it("honours a configured threshold", async () => {
      process.env.AUTO_RESOLVE_CONFIDENCE_THRESHOLD = "0.99";

      expect(await autoResolveTicket(7)).toEqual({ status: "escalated" });
    });

    it("lets a lower threshold through", async () => {
      process.env.AUTO_RESOLVE_CONFIDENCE_THRESHOLD = "0.5";
      completion = decision({ confidence: 0.6 });

      expect(await autoResolveTicket(7)).toEqual({ status: "resolved" });
    });

    // A typo'd threshold must not silently become "send everything".
    it.each([["not-a-number"], ["1.5"], ["-1"]])(
      "falls back to the default when the threshold is %p",
      async (raw) => {
        process.env.AUTO_RESOLVE_CONFIDENCE_THRESHOLD = raw;
        completion = decision({ confidence: 0.5 });
        const restore = silence("warn");

        try {
          expect(await autoResolveTicket(7)).toEqual({ status: "escalated" });
        } finally {
          restore();
        }
      },
    );

    it("treats a blank threshold as unset", async () => {
      process.env.AUTO_RESOLVE_CONFIDENCE_THRESHOLD = "  ";
      completion = decision({ confidence: 0.85 });

      expect(await autoResolveTicket(7)).toEqual({ status: "resolved" });
    });
  });

  // A ticket left in `processing` is invisible to every agent with nothing
  // running to move it on — the worst outcome of any failure here.
  describe("failure never strands the ticket", () => {
    it("returns a transient failure to new so the retry can re-claim it", async () => {
      createError = new Error("upstream is down");

      await expect(autoResolveTicket(7)).rejects.toThrow("upstream is down");

      expect(outcomeCall()).toEqual({
        where: { id: 7, status: TicketStatus.processing },
        data: { status: TicketStatus.new },
      });
    });

    it("returns an unusable completion to new as well", async () => {
      completion = "not json at all";

      await expect(autoResolveTicket(7)).rejects.toThrow("non-JSON resolution");

      expect(outcomeCall()?.data).toEqual({ status: TicketStatus.new });
    });

    it("hands a missing API key straight to the agents", async () => {
      delete process.env.ANTHROPIC_API_KEY;

      await expect(autoResolveTicket(7)).rejects.toBeInstanceOf(
        MissingAutoResolveApiKeyError,
      );

      expect(outcomeCall()?.data).toEqual({ status: TicketStatus.open });
    });

    it("hands an unreadable knowledge base straight to the agents", async () => {
      breakKnowledgeBase();

      await expect(autoResolveTicket(7)).rejects.toThrow(
        "Could not read the knowledge base",
      );

      expect(outcomeCall()?.data).toEqual({ status: TicketStatus.open });
    });

    // Losing the model failure to a secondary database error would hide why the
    // job failed in the first place, and cost the queue its retry signal.
    it("propagates the original failure even if the release itself fails", async () => {
      createError = new Error("upstream is down");
      // The claim succeeds; the release is the call that blows up.
      updateManyErrors = [null, new Error("connection reset")];
      const restore = silence("error");

      try {
        await expect(autoResolveTicket(7)).rejects.toThrow("upstream is down");
      } finally {
        restore();
      }
    });
  });
});

describe("skipAutoResolve", () => {
  // Used when no job will ever run — the feature is off, or the queue refused
  // the job. Without it the ticket keeps `new` and no agent ever sees it.
  it("moves a new ticket to open", async () => {
    await skipAutoResolve(7);

    expect(updateManyCalls[0]).toEqual({
      where: { id: 7, status: TicketStatus.new },
      data: { status: TicketStatus.open },
    });
  });
});

describe("scheduleTicketAutoResolve", () => {
  it("sends a job carrying the new ticket's id", async () => {
    await scheduleTicketAutoResolve({ ticketId: 7, status: "created" });

    expect(sendCalls).toEqual([
      { name: autoResolveQueue, data: { ticketId: 7 } },
    ]);
    expect(updateManyCalls).toHaveLength(0);
  });

  // A reply belongs to a conversation an agent is already in, and a deduped
  // retry was handled by the delivery it duplicates — neither is a candidate.
  it.each([["threaded"], ["deduped"]] as const)(
    "enqueues nothing for a %s delivery",
    async (status) => {
      await scheduleTicketAutoResolve({ ticketId: 7, status });

      expect(sendCalls).toHaveLength(0);
      // Nothing to release: only a created ticket is ever left sitting in `new`.
      expect(updateManyCalls).toHaveLength(0);
    },
  );

  describe("when no job will run", () => {
    // A new ticket is created hidden from the list, so if nothing is going to
    // move it on, this has to — or no agent ever sees it.
    it("hands the ticket to the agents when auto-resolve is switched off", async () => {
      process.env.AUTO_RESOLVE_ENABLED = "false";

      await scheduleTicketAutoResolve({ ticketId: 7, status: "created" });

      expect(sendCalls).toHaveLength(0);
      expect(updateManyCalls[0]).toEqual({
        where: { id: 7, status: TicketStatus.new },
        data: { status: TicketStatus.open },
      });
    });

    it("hands the ticket to the agents when the queue refuses the job", async () => {
      sendError = new Error("queue is down");
      const restore = silence("error");

      try {
        await scheduleTicketAutoResolve({ ticketId: 7, status: "created" });
      } finally {
        restore();
      }

      expect(updateManyCalls[0]?.data).toEqual({ status: TicketStatus.open });
    });

    // The webhook has already told the provider we accepted the email; throwing
    // here would turn a hidden ticket into a redelivery loop.
    it("never rejects, even if the release also fails", async () => {
      sendError = new Error("queue is down");
      updateManyErrors = [new Error("connection reset")];
      const restore = silence("error");

      try {
        await expect(
          scheduleTicketAutoResolve({ ticketId: 7, status: "created" }),
        ).resolves.toBeUndefined();
      } finally {
        restore();
      }
    });
  });

  describe("the kill switch", () => {
    it.each([["true"], ["  "], ["anything-else"]])(
      "stays on for AUTO_RESOLVE_ENABLED=%p",
      async (value) => {
        process.env.AUTO_RESOLVE_ENABLED = value;

        await scheduleTicketAutoResolve({ ticketId: 7, status: "created" });

        expect(sendCalls).toHaveLength(1);
      },
    );

    it("is off for any casing of false", async () => {
      process.env.AUTO_RESOLVE_ENABLED = " FALSE ";

      await scheduleTicketAutoResolve({ ticketId: 7, status: "created" });

      expect(sendCalls).toHaveLength(0);
    });
  });
});

describe("registerAutoResolveWorker", () => {
  it("creates the dead letter queue before the queue that references it", async () => {
    await registerAutoResolveWorker();

    expect(queueCalls.map((call) => call.name)).toEqual([
      autoResolveDeadLetterQueue,
      autoResolveQueue,
    ]);
  });

  it("configures backing-off retries and a dead letter queue", async () => {
    await registerAutoResolveWorker();

    expect(queueCalls[1]?.options).toMatchObject({
      deadLetter: autoResolveDeadLetterQueue,
      retryLimit: 3,
      retryBackoff: true,
    });
  });

  // Sonnet with adaptive thinking writing a full reply takes far longer than the
  // one word Haiku returns for classification.
  it("allows longer than a classification job before expiring", async () => {
    await registerAutoResolveWorker();

    expect(queueCalls[1]?.options?.expireInSeconds).toBe(300);
  });

  // A throw fails the whole batch, so one job per fetch keeps a failing ticket
  // from dragging healthy ones through its retries.
  it("works one job at a time", async () => {
    await registerAutoResolveWorker();

    expect(workCalls).toEqual([
      { name: autoResolveQueue, options: { batchSize: 1 } },
    ]);
  });
});

describe("handleAutoResolveJobs", () => {
  it("resolves the ticket named in the job", async () => {
    await handleAutoResolveJobs([job(7)]);

    expect(claimCall()?.where).toMatchObject({ id: 7 });
    expect(messageCalls).toHaveLength(1);
  });

  it("handles every job in a batch", async () => {
    await handleAutoResolveJobs([job(7), job(8)]);

    expect(updateManyCalls.map((call) => call.where.id)).toEqual([7, 7, 8, 8]);
  });

  // Rejecting is how the worker asks pg-boss for a retry, so a transient
  // failure must not be swallowed here.
  it("rethrows a transient failure so the job is retried", async () => {
    createError = new Error("upstream is down");

    await expect(handleAutoResolveJobs([job(7)])).rejects.toThrow(
      "upstream is down",
    );
  });

  // Retrying cannot conjure an API key or a missing file, and autoResolveTicket
  // has already moved the ticket to `open` — so the job completes rather than
  // burning its attempts into the dead letter queue.
  it("completes the job when no API key is configured", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const restore = silence("warn");

    try {
      await expect(handleAutoResolveJobs([job(7)])).resolves.toBeUndefined();
    } finally {
      restore();
    }

    expect(outcomeCall()?.data).toEqual({ status: TicketStatus.open });
  });

  it("completes the job when the knowledge base cannot be read", async () => {
    breakKnowledgeBase();
    const restore = silence("warn");

    try {
      await expect(handleAutoResolveJobs([job(7)])).resolves.toBeUndefined();
    } finally {
      restore();
    }

    expect(outcomeCall()?.data).toEqual({ status: TicketStatus.open });
  });
});
