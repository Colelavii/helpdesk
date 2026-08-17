import { anthropicClient, messageText } from "../anthropic.ts";

// Overridable so the model can be swapped without a code change.
const model = process.env.POLISH_MODEL ?? "claude-sonnet-5";

// Room for the rewrite plus the thinking that precedes it — max_tokens caps
// both together, and a truncated reply would reach the composer looking whole.
const maxTokens = 4096;

// Enough of the thread to ground tone and terminology without blowing the
// prompt up on long tickets. Oldest messages matter least here.
const threadContextLimit = 6;

export type PolishContext = {
  subject: string;
  requesterName: string | null;
  agentName: string;
  messages: { direction: string; fromName: string | null; body: string }[];
};

const systemPrompt = `You are an editor for a university student-support helpdesk. You rewrite a support agent's draft reply so it is clearer and more professional, and you return nothing but the rewritten reply.

Rules:
- Preserve the draft's meaning, facts, commitments, and intent exactly. Never invent details, policies, dates, names, or promises that are not in the draft.
- If the draft is missing information, leave the gap as it is — do not fill it in.
- Fix grammar, spelling, and punctuation. Tighten rambling sentences.
- Use a warm, respectful, plain-English tone suited to a student reader. No corporate filler, no exclamation marks.
- Keep it roughly the same length or shorter. Keep any existing paragraph or list structure.
- Always open with a short greeting addressing the student by the first name given in the prompt, spelled exactly as provided, followed by a comma. If the prompt says the name is unknown, open with "Hi there," instead — never guess a name, and never leave a placeholder like "[Name]".
- If the draft already opens with a greeting, replace it with this one rather than leaving two.
- Always end the reply with a sign-off: a blank line, a short closing line such as "Best regards," then the agent's first name on the final line, spelled exactly as given. If the draft already ends with a sign-off, replace it with this one rather than leaving two.
- The agent's first name is the entire signature. Never add a surname, job title, team name, phone number, email address, or any other contact detail.
- Output plain text only — no markdown, no quotes around the reply, no preamble such as "Here is the polished reply".`;

export class MissingPolishApiKeyError extends Error {
  constructor() {
    super("ANTHROPIC_API_KEY is not configured");
  }
}

export async function polishReply(
  draft: string,
  context: PolishContext,
): Promise<string> {
  const client = anthropicClient();
  if (!client) throw new MissingPolishApiKeyError();

  const message = await client.messages.create({
    model,
    max_tokens: maxTokens,
    thinking: { type: "adaptive" },
    // A constrained rewrite of text the agent already wrote — the agent is
    // waiting on the button, so latency matters more than deeper reasoning.
    output_config: { effort: "low" },
    system: systemPrompt,
    messages: [{ role: "user", content: buildPrompt(draft, context) }],
  });

  const polished = messageText(message);
  // An empty completion would silently wipe the agent's draft.
  return polished === "" ? draft : polished;
}

// Greeting and signature both use first names only — "Hi Sam Student," and
// "Best regards, Alex Agent" read like a form letter.
function firstNameOf(name: string | null): string | undefined {
  return name?.trim().split(/\s+/)[0] || undefined;
}

function buildPrompt(draft: string, context: PolishContext): string {
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

  const studentFirstName = firstNameOf(context.requesterName);
  // Fall back to the raw value if it somehow has no leading word, so a blank
  // signature can never reach the student.
  const agentFirstName = firstNameOf(context.agentName) ?? context.agentName;

  return [
    "Ticket subject: " + context.subject,
    "Student's first name (greet them with exactly this): " +
      (studentFirstName ?? "unknown — greet them without a name"),
    "Agent's first name (sign the reply with exactly this): " + agentFirstName,
    "",
    "Conversation so far (context only — do not reply to it):",
    thread || "(no messages yet)",
    "",
    "Agent's draft reply to rewrite:",
    draft,
  ].join("\n");
}
