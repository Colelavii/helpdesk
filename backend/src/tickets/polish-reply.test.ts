import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
// Type-only, so it's erased and doesn't load the real module before the mocks.
import type { PolishContext } from "./polish-reply.ts";

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

const { polishReply, MissingPolishApiKeyError } = await import(
  "./polish-reply.ts"
);

const originalApiKey = process.env.ANTHROPIC_API_KEY;

function context(overrides: Partial<PolishContext> = {}): PolishContext {
  return {
    subject: "Cannot access the portal",
    requesterName: "Sam Student",
    agentName: "Alex Agent",
    messages: [],
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
  completion = "Polished reply.";
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";
});

afterEach(() => {
  if (originalApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = originalApiKey;
});

describe("polishReply", () => {
  describe("configuration", () => {
    it("throws MissingPolishApiKeyError when no API key is set", async () => {
      delete process.env.ANTHROPIC_API_KEY;

      await expect(polishReply("draft", context())).rejects.toBeInstanceOf(
        MissingPolishApiKeyError,
      );
    });

    it("does not call the model when the key is missing", async () => {
      delete process.env.ANTHROPIC_API_KEY;

      await polishReply("draft", context()).catch(() => {});

      expect(calls).toHaveLength(0);
    });

    it("treats an empty-string key as missing", async () => {
      process.env.ANTHROPIC_API_KEY = "";

      await expect(polishReply("draft", context())).rejects.toBeInstanceOf(
        MissingPolishApiKeyError,
      );
    });

    it("sends the configured model at a low effort", async () => {
      await polishReply("draft", context());

      expect(calls[0]?.model).toBe("claude-sonnet-5");
      expect(calls[0]?.output_config.effort).toBe("low");
    });

    // Sonnet 5 rejects temperature/top_p/top_k outright, and max_tokens has to
    // cover the thinking blocks as well as the rewrite.
    it("uses adaptive thinking with room for it in max_tokens", async () => {
      await polishReply("draft", context());

      expect(calls[0]?.thinking.type).toBe("adaptive");
      expect(calls[0]?.max_tokens).toBe(4096);
      expect(calls[0]).not.toHaveProperty("temperature");
    });
  });

  describe("return value", () => {
    it("returns the trimmed completion", async () => {
      completion = "  Thanks for getting in touch.\n\n";

      expect(await polishReply("draft", context())).toBe(
        "Thanks for getting in touch.",
      );
    });

    // A blank completion must never silently wipe what the agent typed.
    it("falls back to the original draft on an empty completion", async () => {
      completion = "";

      expect(await polishReply("my draft", context())).toBe("my draft");
    });

    it("falls back to the original draft on a whitespace-only completion", async () => {
      completion = "   \n  \t ";

      expect(await polishReply("my draft", context())).toBe("my draft");
    });
  });

  describe("names in the prompt", () => {
    it("passes the student's first name only", async () => {
      await polishReply("draft", context({ requesterName: "Sam Student" }));

      expect(lastPrompt()).toContain(
        "Student's first name (greet them with exactly this): Sam\n",
      );
    });

    it("passes the agent's first name only", async () => {
      await polishReply("draft", context({ agentName: "Alex Agent" }));

      expect(lastPrompt()).toContain(
        "Agent's first name (sign the reply with exactly this): Alex\n",
      );
    });

    it("keeps a single-word name as-is", async () => {
      await polishReply(
        "draft",
        context({ requesterName: "Prince", agentName: "Cher" }),
      );

      expect(lastPrompt()).toContain(
        "Student's first name (greet them with exactly this): Prince\n",
      );
      expect(lastPrompt()).toContain(
        "Agent's first name (sign the reply with exactly this): Cher\n",
      );
    });

    it("ignores surrounding whitespace in a name", async () => {
      await polishReply("draft", context({ requesterName: "  Sam  Student " }));

      expect(lastPrompt()).toContain(
        "Student's first name (greet them with exactly this): Sam\n",
      );
    });

    // Webhook-created tickets don't always carry a display name; the model is
    // told so explicitly rather than left to invent one.
    it("marks the student's name unknown when it is null", async () => {
      await polishReply("draft", context({ requesterName: null }));

      expect(lastPrompt()).toContain(
        "Student's first name (greet them with exactly this): unknown — greet them without a name",
      );
    });

    it("marks the student's name unknown when it is only whitespace", async () => {
      await polishReply("draft", context({ requesterName: "   " }));

      expect(lastPrompt()).toContain(
        "Student's first name (greet them with exactly this): unknown — greet them without a name",
      );
    });

    // An unusable agent name must not yield a blank signature instruction.
    it("falls back to the raw agent name when it has no leading word", async () => {
      await polishReply("draft", context({ agentName: "   " }));

      expect(lastPrompt()).toContain(
        "Agent's first name (sign the reply with exactly this):    \n",
      );
    });
  });

  describe("prompt contents", () => {
    it("includes the ticket subject and the draft", async () => {
      await polishReply(
        "cant login pls help",
        context({ subject: "Portal locked me out" }),
      );

      expect(lastPrompt()).toContain("Ticket subject: Portal locked me out");
      expect(lastPrompt()).toContain(
        "Agent's draft reply to rewrite:\ncant login pls help",
      );
    });

    it("notes an empty thread rather than leaving a blank section", async () => {
      await polishReply("draft", context({ messages: [] }));

      expect(lastPrompt()).toContain("(no messages yet)");
    });

    it("labels messages by sender and direction", async () => {
      await polishReply(
        "draft",
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
      await polishReply(
        "draft",
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

    // Long tickets must not blow up the prompt — only the newest 6 are sent.
    it("includes only the last six messages of a longer thread", async () => {
      const messages = Array.from({ length: 8 }, (_, i) => ({
        direction: "inbound",
        fromName: "Sam",
        body: `message-${i}`,
      }));

      await polishReply("draft", context({ messages }));

      expect(lastPrompt()).not.toContain("message-0");
      expect(lastPrompt()).not.toContain("message-1");
      for (const i of [2, 3, 4, 5, 6, 7]) {
        expect(lastPrompt()).toContain(`message-${i}`);
      }
    });
  });

  describe("system prompt", () => {
    it("tells the model to greet and sign with first names", async () => {
      await polishReply("draft", context());

      const { system } = calls[0]!;
      expect(system).toContain("Always open with a short greeting");
      expect(system).toContain("Always end the reply with a sign-off");
    });

    // The model would otherwise invent a plausible-looking support signature.
    it("forbids inventing contact details in the signature", async () => {
      await polishReply("draft", context());

      const { system } = calls[0]!;
      expect(system).toContain(
        "Never add a surname, job title, team name, phone number, email address",
      );
    });

    it("forbids inventing facts the draft does not contain", async () => {
      await polishReply("draft", context());

      expect(calls[0]!.system).toContain(
        "Never invent details, policies, dates, names, or promises",
      );
    });
  });
});
