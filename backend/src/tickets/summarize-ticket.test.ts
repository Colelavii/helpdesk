import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
// Type-only, so it's erased and doesn't load the real module before the mocks.
import type { SummaryContext } from "./summarize-ticket.ts";

// Stub the SDK before importing the module under test, so nothing here touches
// the network or needs a real key. `messages.create` records the params it was
// handed, which is how the prompt assertions below read the built prompt.
type CreateParams = {
  model: string;
  max_tokens: number;
  thinking: { type: string };
  output_config: { effort: string };
  system: string;
  messages: { role: string; content: string }[];
};

let calls: CreateParams[] = [];
let completion = "";

mock.module("@anthropic-ai/sdk", () => ({
  default: class {
    messages = {
      create: async (params: CreateParams) => {
        calls.push(params);
        // Thinking blocks ride alongside the answer and carry no text — the
        // module has to skip them rather than read the first block.
        return {
          content: [
            { type: "thinking", thinking: "" },
            { type: "text", text: completion },
          ],
        };
      },
    };
  },
}));

const { summarizeTicket, MissingSummaryApiKeyError } = await import(
  "./summarize-ticket.ts"
);

const originalApiKey = process.env.ANTHROPIC_API_KEY;

function context(overrides: Partial<SummaryContext> = {}): SummaryContext {
  return {
    subject: "Cannot access the portal",
    requesterName: "Sam Student",
    status: "open",
    category: "technical",
    messages: [
      { direction: "inbound", fromName: "Sam", body: "I can't log in." },
    ],
    ...overrides,
  };
}

function lastPrompt(): string {
  const call = calls.at(-1);
  if (!call) throw new Error("messages.create was never called");
  return call.messages[0]!.content;
}

beforeEach(() => {
  calls = [];
  completion = "Sam cannot log in.";
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";
});

afterEach(() => {
  if (originalApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = originalApiKey;
});

describe("summarizeTicket", () => {
  describe("configuration", () => {
    it("throws MissingSummaryApiKeyError when no API key is set", async () => {
      delete process.env.ANTHROPIC_API_KEY;

      await expect(summarizeTicket(context())).rejects.toBeInstanceOf(
        MissingSummaryApiKeyError,
      );
    });

    it("does not call the model when the key is missing", async () => {
      delete process.env.ANTHROPIC_API_KEY;

      await summarizeTicket(context()).catch(() => {});

      expect(calls).toHaveLength(0);
    });

    it("treats an empty-string key as missing", async () => {
      process.env.ANTHROPIC_API_KEY = "";

      await expect(summarizeTicket(context())).rejects.toBeInstanceOf(
        MissingSummaryApiKeyError,
      );
    });

    // A summary weighs the whole thread against a fixed output structure, so it
    // gets more headroom than the polish action's `low`.
    it("sends the configured model at a medium effort", async () => {
      await summarizeTicket(context());

      expect(calls[0]?.model).toBe("claude-sonnet-5");
      expect(calls[0]?.output_config.effort).toBe("medium");
    });

    // Sonnet 5 rejects temperature/top_p/top_k outright, and max_tokens has to
    // cover the thinking blocks as well as the summary.
    it("uses adaptive thinking with room for it in max_tokens", async () => {
      await summarizeTicket(context());

      expect(calls[0]?.thinking.type).toBe("adaptive");
      expect(calls[0]?.max_tokens).toBe(4096);
      expect(calls[0]).not.toHaveProperty("temperature");
    });
  });

  describe("return value", () => {
    it("returns the trimmed completion", async () => {
      completion = "  Sam is locked out of the portal.\n\n";

      expect(await summarizeTicket(context())).toBe(
        "Sam is locked out of the portal.",
      );
    });

    // There is nothing to fall back to, and a blank summary card would read as
    // "this ticket has nothing in it" — so it has to surface as a failure.
    it("throws on an empty completion", async () => {
      completion = "";

      await expect(summarizeTicket(context())).rejects.toThrow(
        "The model returned an empty summary",
      );
    });

    it("throws on a whitespace-only completion", async () => {
      completion = "   \n  \t ";

      await expect(summarizeTicket(context())).rejects.toThrow(
        "The model returned an empty summary",
      );
    });
  });

  describe("prompt contents", () => {
    it("includes the ticket's subject, status, and category", async () => {
      await summarizeTicket(
        context({
          subject: "Portal locked me out",
          status: "resolved",
          category: "technical",
        }),
      );

      expect(lastPrompt()).toContain("Ticket subject: Portal locked me out");
      expect(lastPrompt()).toContain("Current status: resolved");
      expect(lastPrompt()).toContain("Category: technical");
    });

    it("marks an uncategorised ticket rather than leaving the line blank", async () => {
      await summarizeTicket(context({ category: null }));

      expect(lastPrompt()).toContain("Category: not categorised yet");
    });

    it("passes the student's full name", async () => {
      await summarizeTicket(context({ requesterName: "Sam Student" }));

      expect(lastPrompt()).toContain("Student's name: Sam Student");
    });

    // Webhook-created tickets don't always carry a display name; the model is
    // told so explicitly rather than left to invent one.
    it("marks the student's name unknown when it is null", async () => {
      await summarizeTicket(context({ requesterName: null }));

      expect(lastPrompt()).toContain("Student's name: unknown");
    });

    it("marks the student's name unknown when it is only whitespace", async () => {
      await summarizeTicket(context({ requesterName: "   " }));

      expect(lastPrompt()).toContain("Student's name: unknown");
    });

    it("labels messages by sender and direction", async () => {
      await summarizeTicket(
        context({
          messages: [
            { direction: "inbound", fromName: "Sam", body: "I can't log in." },
            { direction: "outbound", fromName: "Alex", body: "Looking now." },
          ],
        }),
      );

      expect(lastPrompt()).toContain("Sam (inbound):\nI can't log in.");
      expect(lastPrompt()).toContain("Alex (outbound):\nLooking now.");
    });

    it("falls back to generic sender labels when fromName is null", async () => {
      await summarizeTicket(
        context({
          messages: [
            { direction: "inbound", fromName: null, body: "Help please." },
            { direction: "outbound", fromName: null, body: "On it." },
          ],
        }),
      );

      expect(lastPrompt()).toContain("Student (inbound):\nHelp please.");
      expect(lastPrompt()).toContain("Agent (outbound):\nOn it.");
    });

    it("notes an empty thread rather than leaving a blank section", async () => {
      await summarizeTicket(context({ messages: [] }));

      expect(lastPrompt()).toContain("(no messages yet)");
    });
  });

  describe("long threads", () => {
    function thread(length: number) {
      return Array.from({ length }, (_, i) => ({
        direction: "inbound",
        fromName: "Sam",
        body: `message-${i}`,
      }));
    }

    it("includes the whole thread when it fits the limit", async () => {
      await summarizeTicket(context({ messages: thread(40) }));

      expect(lastPrompt()).toContain("message-0");
      expect(lastPrompt()).toContain("message-39");
      expect(lastPrompt()).not.toContain("oldest message(s) are not shown");
    });

    // A summary needs far more of the thread than a polished reply does, but a
    // very long ticket still can't be sent whole.
    it("keeps only the newest forty messages of a longer thread", async () => {
      await summarizeTicket(context({ messages: thread(43) }));

      expect(lastPrompt()).not.toContain("message-0\n");
      expect(lastPrompt()).not.toContain("message-2\n");
      expect(lastPrompt()).toContain("message-3");
      expect(lastPrompt()).toContain("message-42");
    });

    // The model must not imply it summarised messages it never saw.
    it("tells the model how many older messages were dropped", async () => {
      await summarizeTicket(context({ messages: thread(43) }));

      expect(lastPrompt()).toContain(
        "(the 3 oldest message(s) are not shown",
      );
    });
  });

  describe("system prompt", () => {
    it("forbids inventing anything the ticket does not contain", async () => {
      await summarizeTicket(context());

      expect(calls[0]!.system).toContain(
        "Never invent details, policies, dates, names, promises, or outcomes",
      );
    });

    it("tells the model to write for the agent, not the student", async () => {
      await summarizeTicket(context());

      const { system } = calls[0]!;
      expect(system).toContain("Write for the agent, not the student");
      expect(system).toContain("never draft a reply");
    });

    it("asks for the key points and next step structure", async () => {
      await summarizeTicket(context());

      const { system } = calls[0]!;
      expect(system).toContain('"Key points:"');
      expect(system).toContain('"Next step: "');
    });
  });
});
