import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  knowledgeBase,
  MissingKnowledgeBaseError,
  resetKnowledgeBaseCache,
} from "./knowledge-base.ts";

const originalPath = process.env.KNOWLEDGE_BASE_PATH;
let dir = "";

function writeKnowledgeBase(contents: string): string {
  const path = join(dir, "knowledge-base.md");
  writeFileSync(path, contents, "utf8");
  return path;
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "helpdesk-kb-"));
  resetKnowledgeBaseCache();
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  if (originalPath === undefined) delete process.env.KNOWLEDGE_BASE_PATH;
  else process.env.KNOWLEDGE_BASE_PATH = originalPath;
  resetKnowledgeBaseCache();
});

describe("knowledgeBase", () => {
  // The default path is resolved from the module, not the working directory, so
  // this also pins that the shipped file is where the loader expects it.
  it("reads the repository's knowledge base when no path is configured", () => {
    delete process.env.KNOWLEDGE_BASE_PATH;

    expect(knowledgeBase()).toContain("Code with Mosh");
  });

  it("reads the file named by KNOWLEDGE_BASE_PATH", () => {
    process.env.KNOWLEDGE_BASE_PATH = writeKnowledgeBase("# Local policy");

    expect(knowledgeBase()).toBe("# Local policy");
  });

  it("falls back to the default when the override is blank", () => {
    process.env.KNOWLEDGE_BASE_PATH = "   ";

    expect(knowledgeBase()).toContain("Code with Mosh");
  });

  // The auto-resolve worker calls this on every ticket; re-reading the file each
  // time would be pure waste for static support policy.
  it("reads the file once and serves the cached copy after", () => {
    const path = writeKnowledgeBase("# First");
    process.env.KNOWLEDGE_BASE_PATH = path;

    expect(knowledgeBase()).toBe("# First");
    writeFileSync(path, "# Second", "utf8");

    expect(knowledgeBase()).toBe("# First");
  });

  it("re-reads after the cache is reset", () => {
    const path = writeKnowledgeBase("# First");
    process.env.KNOWLEDGE_BASE_PATH = path;
    knowledgeBase();

    writeFileSync(path, "# Second", "utf8");
    resetKnowledgeBaseCache();

    expect(knowledgeBase()).toBe("# Second");
  });

  it("throws when the file is missing, naming the path it tried", () => {
    const missing = join(dir, "nope.md");
    process.env.KNOWLEDGE_BASE_PATH = missing;

    expect(() => knowledgeBase()).toThrow(MissingKnowledgeBaseError);
    expect(() => knowledgeBase()).toThrow(missing);
  });

  // An empty file loads successfully but leaves the model with no policy to
  // answer from — it would resolve tickets out of thin air.
  it("throws on an empty file rather than answering from nothing", () => {
    process.env.KNOWLEDGE_BASE_PATH = writeKnowledgeBase("   \n\n  ");

    expect(() => knowledgeBase()).toThrow(MissingKnowledgeBaseError);
  });

  it("does not cache a failed read", () => {
    const path = join(dir, "late.md");
    process.env.KNOWLEDGE_BASE_PATH = path;
    expect(() => knowledgeBase()).toThrow(MissingKnowledgeBaseError);

    writeFileSync(path, "# Arrived late", "utf8");

    expect(knowledgeBase()).toBe("# Arrived late");
  });
});
