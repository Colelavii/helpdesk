import { z } from "zod";
import { TicketCategory } from "@helpdesk/core";
import { anthropicClient, messageText } from "../anthropic.ts";

// Overridable so the model can be swapped without a code change.
const model = process.env.CLASSIFY_MODEL ?? "claude-haiku-4-5";

// The whole answer is `{"category": "..."}`, and this model has no thinking to
// leave room for — anything larger would only mask a malformed response.
const maxTokens = 256;

// Inbound bodies are already capped by the webhook schema, so this only guards
// against a future caller (a manual ticket, another provider adapter) handing
// over something unbounded. The model is told when the text was cut.
const bodyLimit = 4_000;

export type ClassificationContext = {
  subject: string;
  body: string;
};

// The model is constrained to this shape by `output_config.format`, so an
// invalid category can't come back — the parse below is a second line of
// defence for a swapped-out model that ignores the constraint.
const responseSchema = {
  type: "object",
  properties: {
    category: { type: "string", enum: Object.values(TicketCategory) },
  },
  required: ["category"],
  additionalProperties: false,
} as const;

const responseParser = z.object({ category: z.enum(TicketCategory) });

const systemPrompt = `You are classifying an inbound support email for a university student-support helpdesk. You assign it exactly one category.

Decide by who has to answer the email, not by whether it happens to mention a computer.

Categories:
- "refund" — the student wants money back, or is disputing or querying a charge, payment, invoice, fee, or deposit.
- "technical" — answering it needs technical or IT expertise: software, tools, databases, servers, versions, installing or configuring something, coursework tooling, network or account infrastructure. Also anything that is broken or inaccessible — an error message, a system that is down, a failed upload, a login that will not work.
- "general" — routine student-facing business the front line can answer from published guidance, even when an account or a system is involved: where to find a setting, how to change a password or update personal details, policies, deadlines, fees as information, courses, enrolment, timetables, documents, appointments.

Rules:
- Classify only on what the email actually says. Never infer facts, amounts, or history that are not in it.
- A documented self-service step is "general", not "technical", when nothing is failing: "how do I change my password", "where do I update my address", "how do I turn on notifications" are all "general".
- A question that needs specialist knowledge is "technical" even when nothing is broken and the student is only asking: which database version to install, whether a server is provided, how to configure a tool, why code behaves a certain way.
- Something that is not working is "technical" whatever it concerns — including passwords and logins: "my password reset link does nothing" is "technical", while "how do I change my password" is "general".
- Money in dispute outranks an accompanying technical symptom: "the payment page errored and I want my money back" is "refund", while a payment page that is merely broken with no money in question is "technical".
- If the email is empty, unintelligible, or fits none of the categories, choose "general".
- Respond with only the JSON object the response format requires — no explanation.`;

export class MissingClassificationApiKeyError extends Error {
  constructor() {
    super("ANTHROPIC_API_KEY is not configured");
  }
}

export async function classifyTicket(
  context: ClassificationContext,
): Promise<TicketCategory> {
  const client = anthropicClient();
  if (!client) throw new MissingClassificationApiKeyError();

  const message = await client.messages.create({
    model,
    max_tokens: maxTokens,
    output_config: { format: { type: "json_schema", schema: responseSchema } },
    system: systemPrompt,
    messages: [{ role: "user", content: buildPrompt(context) }],
  });

  return parseCategory(messageText(message));
}

function parseCategory(text: string): TicketCategory {
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`The model returned a non-JSON classification: ${text}`);
  }

  const parsed = responseParser.safeParse(payload);
  if (!parsed.success) {
    throw new Error(`The model returned an unknown category: ${text}`);
  }
  return parsed.data.category;
}

function buildPrompt(context: ClassificationContext): string {
  const body = context.body.trim();
  const truncated = body.length > bodyLimit;

  return [
    "Subject: " + (context.subject.trim() || "(no subject)"),
    "",
    "Message body:",
    body.slice(0, bodyLimit) || "(empty)",
    ...(truncated ? ["", "(the rest of the message is not shown)"] : []),
  ].join("\n");
}
