import { z } from "zod";
import { anthropicClient, messageText } from "../anthropic.ts";
import { knowledgeBase } from "./knowledge-base.ts";

// Overridable so the model can be swapped without a code change. Sonnet rather
// than the Haiku used for classification: this writes the text a student
// actually receives, and the escalation call is a judgement, not a label.
const model = process.env.AUTO_RESOLVE_MODEL ?? "claude-sonnet-5";

// Has to cover the thinking as well as the reply itself.
const maxTokens = 4096;

// Matches classify-ticket.ts: inbound bodies are already capped by the webhook
// schema, so this only guards a future caller handing over something unbounded.
// The model is told when the text was cut.
const bodyLimit = 4_000;

export type ResolutionContext = {
  subject: string;
  body: string;
  requesterName: string;
};

export type ResolutionDecision = {
  action: "resolve" | "escalate";
  // The model's own 0–1 confidence in the decision it made — not in the ticket
  // being answerable. Only a "resolve" is gated on it; a confident "escalate"
  // is an ordinary outcome (an escalation rule fired), not a contradiction.
  confidence: number;
  reason: string;
  // The student-facing reply. Empty on an escalation.
  reply: string;
};

// Numeric bounds and conditional requirements aren't expressible in a structured
// output schema, so the shape is constrained here and the range and the
// reply-present rule are enforced by the parser below.
const responseSchema = {
  type: "object",
  properties: {
    action: { type: "string", enum: ["resolve", "escalate"] },
    confidence: { type: "number" },
    reason: { type: "string" },
    reply: { type: "string" },
  },
  required: ["action", "confidence", "reason", "reply"],
  additionalProperties: false,
} as const;

const responseParser = z
  .object({
    action: z.enum(["resolve", "escalate"]),
    confidence: z.number().min(0).max(1),
    reason: z.string(),
    reply: z.string(),
  })
  .refine(
    (decision) =>
      decision.action !== "resolve" || decision.reply.trim().length > 0,
    { message: "a resolve decision must carry a reply" },
  );

const instructions = `You are the first responder on a support helpdesk for Code with Mosh, an online course provider. A student has emailed in. You decide whether the knowledge base below answers them completely, and if it does, you write the reply they receive.

You have exactly two options:
- "resolve" — the knowledge base fully answers this student's question, and you have written that answer as "reply".
- "escalate" — anything else. A human agent picks the ticket up and "reply" is an empty string.

Escalate whenever any of these hold. This list outranks everything else:
- The knowledge base does not cover the question, or covers only part of it.
- Answering would need account-specific facts you do not have: their order, their payment status, how much of a course they completed, what a system did for them.
- Any escalation rule in section 10 of the knowledge base applies — legal action, a refund requested outside the 30-day window, a disputed charge or chargeback, or an account-security concern.
- The student is asking for an action to be performed on their account rather than for information.
- The student is angry, distressed, or has already been let down by a previous reply.
- The email is unintelligible, empty, or you are unsure for any other reason.

"confidence" is your 0–1 confidence in the decision you just made — for "resolve", how sure you are that the reply you wrote fully and correctly answers this student from the knowledge base; for "escalate", how sure you are that a human needs to take it. Report it honestly. A "resolve" below the confidence bar is escalated anyway, which is the safe outcome, so do not inflate it to get a reply sent.

"reason" is one sentence for the agent who may pick this up: which knowledge base section answers it, or why you escalated. It is never shown to the student.

When you resolve, write "reply" as the complete email body:
- Open with "Hi <first name>," using the student's first name exactly as given, or "Hi there," if no name was supplied.
- Answer only from the knowledge base. Never invent a policy, timeframe, amount, URL, or step that is not written there. Never promise anyone will follow up, and never state anything about this student's own account or order.
- Keep the steps in the order the knowledge base gives them, in plain language rather than copied headings.
- Say what to do next if the answer does not resolve it — contact support again.
- Close with "Best regards," on its own line and "The Code with Mosh Support Team" on the next.
- Plain text only: no markdown, no headings, no bold, no subject line, no preamble such as "Here is the reply".

Respond with only the JSON object the response format requires.`;

export class MissingAutoResolveApiKeyError extends Error {
  constructor() {
    super("ANTHROPIC_API_KEY is not configured");
  }
}

export async function resolveTicket(
  context: ResolutionContext,
): Promise<ResolutionDecision> {
  const client = anthropicClient();
  if (!client) throw new MissingAutoResolveApiKeyError();

  const message = await client.messages.create({
    model,
    max_tokens: maxTokens,
    thinking: { type: "adaptive" },
    // The escalation call is worth deliberating over, but this runs on every
    // inbound email — the same middle setting the summary action uses.
    output_config: {
      effort: "medium",
      format: { type: "json_schema", schema: responseSchema },
    },
    system: [
      { type: "text", text: instructions },
      // The knowledge base is byte-identical on every job and comfortably over
      // the cacheable minimum, so a breakpoint here means later tickets read it
      // back at a fraction of the input cost. It goes last because a breakpoint
      // caches everything before it.
      {
        type: "text",
        text: "Knowledge base:\n\n" + knowledgeBase(),
        cache_control: { type: "ephemeral" },
      },
    ],
    messages: [{ role: "user", content: buildPrompt(context) }],
  });

  return parseDecision(messageText(message));
}

function parseDecision(text: string): ResolutionDecision {
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`The model returned a non-JSON resolution: ${text}`);
  }

  const parsed = responseParser.safeParse(payload);
  if (!parsed.success) {
    throw new Error(`The model returned an unusable resolution: ${text}`);
  }
  return parsed.data;
}

function buildPrompt(context: ResolutionContext): string {
  const body = context.body.trim();
  const truncated = body.length > bodyLimit;

  return [
    "Student's name: " + (context.requesterName.trim() || "unknown"),
    "Subject: " + (context.subject.trim() || "(no subject)"),
    "",
    "Message body:",
    body.slice(0, bodyLimit) || "(empty)",
    ...(truncated ? ["", "(the rest of the message is not shown)"] : []),
  ].join("\n");
}
