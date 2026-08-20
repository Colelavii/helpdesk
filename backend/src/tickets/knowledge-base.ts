import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Resolved from this module rather than the working directory, so the loader
// behaves the same under `bun run dev`, a test run, and a container entrypoint.
const defaultPath = fileURLToPath(
  new URL("../../knowledge-base.md", import.meta.url),
);

// Read once and held for the process: the file is static support policy, and the
// auto-resolve worker would otherwise re-read it on every ticket.
let cached: string | null = null;

export class MissingKnowledgeBaseError extends Error {
  constructor(path: string, cause: unknown) {
    super(`Could not read the knowledge base at ${path}`);
    this.cause = cause;
  }
}

export function knowledgeBase(): string {
  if (cached !== null) return cached;

  const path = process.env.KNOWLEDGE_BASE_PATH?.trim() || defaultPath;
  let contents: string;
  try {
    contents = readFileSync(path, "utf8");
  } catch (error) {
    throw new MissingKnowledgeBaseError(path, error);
  }

  // An empty file would leave the model with no policy to answer from while
  // still looking like a successful load, so it fails as loudly as a missing one.
  if (contents.trim() === "") {
    throw new MissingKnowledgeBaseError(path, new Error("the file is empty"));
  }

  cached = contents;
  return cached;
}

// Tests only: drops the cached copy so a different KNOWLEDGE_BASE_PATH takes
// effect. Nothing in the running app should need this.
export function resetKnowledgeBaseCache(): void {
  cached = null;
}
