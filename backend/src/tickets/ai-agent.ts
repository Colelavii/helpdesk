import { prisma } from "../prisma.ts";

const defaultAiAgentEmail = "ai@helpdesk.local";

// The AI agent is a real User row so a ticket can be assigned to it while the
// auto-resolve worker owns it, and so "who answered this?" has an answer on an
// AI-resolved ticket. It is identified by email rather than a schema flag or a
// dedicated Role value — the email is already unique, and a `Role.ai` would mean
// a migration plus touching every `role === agent` assumption in the app.
//
// Better Auth lowercases the emails it stores, so the configured value is
// lowercased here too: an un-normalised comparison would silently never match
// and the AI would look un-seeded forever.
export function aiAgentEmail(): string {
  return (
    process.env.AI_AGENT_EMAIL?.trim().toLowerCase() || defaultAiAgentEmail
  );
}

let cachedId: string | null = null;
let warned = false;

// The AI agent's user id, or null when it hasn't been seeded (`bun run
// db:seed:ai`) or has been soft-deleted.
//
// Never throws. The one caller on a write path is inbound-email intake, and a
// throw there would 5xx the mail provider — turning a missing seed row into a
// redelivery loop on every incoming email. Returning null instead degrades to
// exactly the pre-AI-agent behaviour: tickets are created unassigned.
export async function aiAgentId(): Promise<string | null> {
  if (cachedId !== null) return cachedId;

  try {
    const user = await prisma.user.findFirst({
      where: { email: aiAgentEmail(), deletedAt: null },
      select: { id: true },
    });

    if (!user) {
      // Warn once, not once per inbound email — a misconfigured deployment
      // should be visible in the logs without drowning them.
      if (!warned) {
        warned = true;
        console.warn(
          `No AI agent user found for ${aiAgentEmail()}; tickets will arrive unassigned. Run: bun run db:seed:ai`,
        );
      }
      // Deliberately not cached: seeding the AI user after boot would otherwise
      // need a restart to take effect.
      return null;
    }

    cachedId = user.id;
    return cachedId;
  } catch (error) {
    console.error("Failed to look up the AI agent user", error);
    return null;
  }
}

// Tests only — the id is cached for the life of the process otherwise.
export function resetAiAgentCache(): void {
  cachedId = null;
  warned = false;
}
