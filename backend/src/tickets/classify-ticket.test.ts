import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { TicketCategory } from "@helpdesk/core";
// Type-only, so it's erased and doesn't load the real module before the mocks.
import type { ClassificationContext } from "./classify-ticket.ts";

// Stub the SDK before importing the module under test, so nothing here touches
// the network or needs a real key. `messages.create` records the params it was
// handed, which is how the prompt assertions below read the built prompt.
type CreateParams = {
  model: string;
  max_tokens: number;
  output_config: { format: { type: string; schema: Record<string, unknown> } };
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
        return { content: [{ type: "text", text: completion }] };
      },
    };
  },
}));

const { classifyTicket, MissingClassificationApiKeyError } = await import(
  "./classify-ticket.ts"
);

const originalApiKey = process.env.ANTHROPIC_API_KEY;

function context(
  overrides: Partial<ClassificationContext> = {},
): ClassificationContext {
  return {
    subject: "Cannot access the portal",
    body: "I can't log in — it says my password is wrong.",
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
  completion = '{"category": "technical"}';
  process.env.ANTHROPIC_API_KEY = "sk-ant-test-key";
});

afterEach(() => {
  if (originalApiKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = originalApiKey;
});

describe("classifyTicket", () => {
  describe("configuration", () => {
    it("throws MissingClassificationApiKeyError when no API key is set", async () => {
      delete process.env.ANTHROPIC_API_KEY;

      await expect(classifyTicket(context())).rejects.toBeInstanceOf(
        MissingClassificationApiKeyError,
      );
    });

    it("does not call the model when the key is missing", async () => {
      delete process.env.ANTHROPIC_API_KEY;

      await classifyTicket(context()).catch(() => {});

      expect(calls).toHaveLength(0);
    });

    it("treats an empty-string key as missing", async () => {
      process.env.ANTHROPIC_API_KEY = "";

      await expect(classifyTicket(context())).rejects.toBeInstanceOf(
        MissingClassificationApiKeyError,
      );
    });

    // Classification is a one-word judgement on a short email — the cheapest
    // model, and no thinking to leave room for.
    it("uses the configured model with a small token cap", async () => {
      await classifyTicket(context());

      expect(calls[0]?.model).toBe("claude-haiku-4-5");
      expect(calls[0]?.max_tokens).toBe(256);
      expect(calls[0]).not.toHaveProperty("thinking");
      expect(calls[0]).not.toHaveProperty("temperature");
    });

    // Structured output is what makes an out-of-range category impossible.
    it("constrains the response to the three ticket categories", async () => {
      await classifyTicket(context());

      const { format } = calls[0]!.output_config;
      expect(format.type).toBe("json_schema");
      expect(format.schema).toMatchObject({
        type: "object",
        required: ["category"],
        additionalProperties: false,
        properties: {
          category: { enum: ["general", "technical", "refund"] },
        },
      });
    });
  });

  describe("return value", () => {
    it("returns the category the model chose", async () => {
      completion = '{"category": "refund"}';

      expect(await classifyTicket(context())).toBe(TicketCategory.refund);
    });

    it("tolerates surrounding whitespace", async () => {
      completion = '\n  {"category": "general"}  \n';

      expect(await classifyTicket(context())).toBe(TicketCategory.general);
    });

    it("throws when the completion is not JSON", async () => {
      completion = "technical";

      await expect(classifyTicket(context())).rejects.toThrow(
        "non-JSON classification",
      );
    });

    it("throws on a category outside the enum", async () => {
      completion = '{"category": "billing"}';

      await expect(classifyTicket(context())).rejects.toThrow(
        "unknown category",
      );
    });

    it("throws on an empty completion", async () => {
      completion = "";

      await expect(classifyTicket(context())).rejects.toThrow(
        "non-JSON classification",
      );
    });
  });

  describe("prompt contents", () => {
    it("includes the subject and the message body", async () => {
      await classifyTicket(
        context({ subject: "Refund for my deposit", body: "Please refund me." }),
      );

      expect(lastPrompt()).toContain("Subject: Refund for my deposit");
      expect(lastPrompt()).toContain("Please refund me.");
    });

    it("marks a blank subject rather than leaving the line empty", async () => {
      await classifyTicket(context({ subject: "   " }));

      expect(lastPrompt()).toContain("Subject: (no subject)");
    });

    it("marks an empty body rather than leaving the section blank", async () => {
      await classifyTicket(context({ body: "" }));

      expect(lastPrompt()).toContain("(empty)");
    });

    // The model must not imply it read text it never saw.
    it("truncates a very long body and says so", async () => {
      await classifyTicket(context({ body: "a".repeat(4_100) }));

      expect(lastPrompt()).toContain("a".repeat(4_000));
      expect(lastPrompt()).not.toContain("a".repeat(4_001));
      expect(lastPrompt()).toContain("the rest of the message is not shown");
    });

    it("leaves a body inside the limit intact", async () => {
      await classifyTicket(context({ body: "a".repeat(4_000) }));

      expect(lastPrompt()).not.toContain("the rest of the message is not shown");
    });
  });

  describe("system prompt", () => {
    it("defines all three categories", async () => {
      await classifyTicket(context());

      const { system } = calls[0]!;
      expect(system).toContain('"general"');
      expect(system).toContain('"technical"');
      expect(system).toContain('"refund"');
    });

    it("forbids inferring anything the email does not contain", async () => {
      await classifyTicket(context());

      expect(calls[0]!.system).toContain(
        "Never infer facts, amounts, or history that are not in it",
      );
    });

    it("resolves refund-versus-technical ambiguity and falls back to general", async () => {
      await classifyTicket(context());

      const { system } = calls[0]!;
      expect(system).toContain("Money in dispute outranks");
      expect(system).toContain('fits none of the categories, choose "general"');
    });

    // The general/technical split is by who answers the email, not by whether a
    // system is mentioned — a documented self-service step is front-line work,
    // while a tooling question is specialist even with nothing broken.
    it("splits general from technical on required expertise, not subject matter", async () => {
      await classifyTicket(context());

      const { system } = calls[0]!;
      expect(system).toContain(
        "Decide by who has to answer the email, not by whether it happens to mention a computer",
      );
      expect(system).toContain(
        'A documented self-service step is "general", not "technical", when nothing is failing',
      );
      expect(system).toContain(
        'A question that needs specialist knowledge is "technical" even when nothing is broken',
      );
    });

    it("keeps a broken login technical while a password how-to stays general", async () => {
      await classifyTicket(context());

      expect(calls[0]!.system).toContain(
        '"my password reset link does nothing" is "technical", while "how do I change my password" is "general"',
      );
    });
  });
});
