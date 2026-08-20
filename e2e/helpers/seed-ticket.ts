/**
 * Seeds a ticket row directly into the test DB via Prisma, bypassing the
 * inbound-email webhook and the auto-resolve queue. Runs
 * backend/src/seed-test-ticket.ts as a Bun child process — same pattern as
 * provision-agent.ts — so e2e specs never import backend source directly.
 *
 * Use this only when a test needs a ticket at a specific status /
 * aiResolvedAt combination *deterministically* (no dependency on the
 * auto-resolve worker's timing). Tests that just need "a ticket exists" or
 * exercise the real create/thread/dedupe path should keep using the
 * inbound-email webhook, as the rest of e2e/ already does.
 */
import { execSync } from "node:child_process";
import { BACKEND_DIR } from "./provision-agent.ts";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Prefix the seed script tags its result line with — keep both in sync. */
const SEED_MARKER = "SEEDED_TICKET";

const SEED_SCRIPT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../backend/src/seed-test-ticket.ts",
);

export interface SeedTicketOptions {
  status: "new" | "processing" | "open" | "resolved" | "closed";
  aiResolvedAt: boolean;
  subject: string;
  requesterEmail: string;
  requesterName: string;
}

/** Directly creates a ticket row at the given status/aiResolvedAt and returns its id. */
export function seedTicket(options: SeedTicketOptions): number {
  const { status, aiResolvedAt, subject, requesterEmail, requesterName } = options;

  const output = execSync(
    `bun --env-file=.env.test run "${SEED_SCRIPT}" "${status}" "${String(aiResolvedAt)}" "${subject}" "${requesterEmail}" "${requesterName}"`,
    { cwd: BACKEND_DIR, stdio: ["ignore", "pipe", "inherit"] },
  ).toString();

  // Not JSON.parse(output): the shared Prisma client logs every query to stdout
  // outside production (backend/src/prisma.ts), so the script's own line has to
  // be picked out of that noise. The prefix is set in seed-test-ticket.ts.
  const line = output
    .split("\n")
    .map((candidate) => candidate.trim())
    .find((candidate) => candidate.startsWith(`${SEED_MARKER} `));

  if (!line) {
    throw new Error(
      `seed-test-ticket.ts printed no "${SEED_MARKER}" line. Output was:\n${output}`,
    );
  }

  const { id } = JSON.parse(line.slice(SEED_MARKER.length + 1)) as {
    id: number;
  };
  return id;
}
