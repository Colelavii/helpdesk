import { anthropicClient, messageText } from "../anthropic.ts";

// Overridable so the model can be swapped without a code change.
const model = process.env.SUMMARY_MODEL ?? "claude-sonnet-5";

// The summary itself is capped at 120 words, but max_tokens also has to cover
// the thinking that precedes it.
const maxTokens = 4096;

// A summary has to account for the whole ticket, so this cap is far higher than
// the polish one. Past it the oldest messages are dropped — and the model is
// told so, rather than being left to imply it summarised everything.
const threadContextLimit = 40;

export type SummaryContext = {
  subject: string;
  requesterName: string | null;
  status: string;
  category: string | null;
  messages: { direction: string; fromName: string | null; body: string }[];
};

const systemPrompt = `You are summarising a support ticket for a university student-support helpdesk. An agent who has never seen this ticket reads your summary to get oriented in a few seconds.

Rules:
- Summarise only what the ticket and its conversation actually say. Never invent details, policies, dates, names, promises, or outcomes.
- If something important is unknown or unresolved, say so plainly instead of guessing or smoothing it over.
- Write for the agent, not the student: refer to the student in the third person, never address anyone, and never draft a reply.
- Carry over concrete specifics exactly as given — dates, reference numbers, amounts, error messages.
- Output exactly this structure and nothing else:
  One sentence stating what the student needs.
  A blank line.
  A line reading "Key points:" followed by up to five lines, each starting with "- ", covering what was asked, what the agent has already done or promised, and any facts that matter.
  A blank line.
  A line starting with "Next step: " and one sentence describing what the agent should do next — or exactly "Next step: None — waiting on the student." when the ball is in the student's court.
- Keep the whole summary under 120 words.
- Output plain text only — no markdown headings, no bold, no preamble such as "Here is the summary".`;

export class MissingSummaryApiKeyError extends Error {
  constructor() {
    super("ANTHROPIC_API_KEY is not configured");
  }
}

export async function summarizeTicket(
  context: SummaryContext,
): Promise<string> {
  const client = anthropicClient();
  if (!client) throw new MissingSummaryApiKeyError();

  const message = await client.messages.create({
    model,
    max_tokens: maxTokens,
    thinking: { type: "adaptive" },
    // Higher than the polish action: this has to weigh a whole thread and hold
    // to a fixed output structure, not just rewrite a paragraph.
    output_config: { effort: "medium" },
    system: systemPrompt,
    messages: [{ role: "user", content: buildPrompt(context) }],
  });

  const summary = messageText(message);
  // Unlike a polished draft there is nothing to fall back to, and a blank card
  // would read as "this ticket has nothing in it" — surface it as a failure.
  if (summary === "") throw new Error("The model returned an empty summary");
  return summary;
}

function buildPrompt(context: SummaryContext): string {
  const omitted = Math.max(0, context.messages.length - threadContextLimit);

  const thread = context.messages
    .slice(-threadContextLimit)
    .map((message) => {
      const who =
        message.direction === "inbound"
          ? (message.fromName ?? "Student")
          : (message.fromName ?? "Agent");
      return `${who} (${message.direction}):\n${message.body}`;
    })
    .join("\n\n");

  return [
    "Ticket subject: " + context.subject,
    "Student's name: " + (context.requesterName?.trim() || "unknown"),
    "Current status: " + context.status,
    "Category: " + (context.category ?? "not categorised yet"),
    "",
    "Conversation, oldest first:",
    ...(omitted > 0
      ? [
          `(the ${omitted} oldest message(s) are not shown — note that the summary covers only the recent conversation)`,
        ]
      : []),
    thread || "(no messages yet)",
  ].join("\n");
}

