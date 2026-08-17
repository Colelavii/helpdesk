import Anthropic from "@anthropic-ai/sdk";

// Constructed per call rather than as a module singleton: the constructor
// throws when ANTHROPIC_API_KEY is unset, and the AI features are optional —
// the backend must still boot (and serve everything else) without a key.
// Unlike the Prisma client there is no pool to reuse, so this costs nothing.
export function anthropicClient(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  return new Anthropic();
}

// A response also carries thinking blocks, whose text is empty unless
// `display: "summarized"` is requested — reading `content[0].text` would return
// nothing on those turns.
export function messageText(message: Anthropic.Message): string {
  return message.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("")
    .trim();
}
