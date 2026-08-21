import { TicketStatus } from "@helpdesk/core";
import { prisma } from "../prisma.ts";
import {
  MissingAutoResolveApiKeyError,
  resolveTicket,
} from "./resolve-ticket.ts";
import { MissingKnowledgeBaseError } from "./knowledge-base.ts";

export interface AutoResolveResult {
  status: "resolved" | "escalated" | "skipped" | "superseded";
}

const defaultConfidenceThreshold = 0.8;

// Read per call rather than at import so a deployment can retune it with a
// restart, and so tests can set it without reloading the module.
function confidenceThreshold(): number {
  const raw = process.env.AUTO_RESOLVE_CONFIDENCE_THRESHOLD;
  if (raw === undefined || raw.trim() === "") return defaultConfidenceThreshold;

  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    console.warn(
      `Ignoring AUTO_RESOLVE_CONFIDENCE_THRESHOLD=${raw}: expected a number between 0 and 1`,
    );
    return defaultConfidenceThreshold;
  }
  return value;
}

// The identity an auto-sent reply is attributed to. It is not a User — no member
// of staff wrote it — so the message's `sentById` stays null.
function supportIdentity(): { email: string; name: string } {
  return {
    email: process.env.SUPPORT_EMAIL?.trim() || "support@example.com",
    name: process.env.SUPPORT_NAME?.trim() || "Support",
  };
}

// Retrying cannot fix a missing key or an unreadable knowledge base, so the
// ticket is handed straight to an agent instead of bouncing through the queue's
// retries first.
function isUnretryable(error: unknown): boolean {
  return (
    error instanceof MissingAutoResolveApiKeyError ||
    error instanceof MissingKnowledgeBaseError
  );
}

// Answer a freshly arrived ticket from the knowledge base, or hand it to an
// agent. Runs from the auto-resolve queue against tickets the inbound-email
// webhook created, which arrive as `new`.
export async function autoResolveTicket(
  ticketId: number,
): Promise<AutoResolveResult> {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    select: {
      status: true,
      subject: true,
      requesterName: true,
      messages: {
        where: { direction: "inbound" },
        select: { body: true },
        orderBy: { createdAt: "asc" },
        take: 1,
      },
    },
  });

  // Gone, or an agent has already moved it out of the auto-resolve window.
  if (!ticket) return { status: "skipped" };
  if (
    ticket.status !== TicketStatus.new &&
    ticket.status !== TicketStatus.processing
  ) {
    return { status: "skipped" };
  }

  // Claim it before calling the model, so the ticket stays out of the agents'
  // list for the whole call. `processing` is accepted as a prior state on
  // purpose: it lets a retry re-claim a ticket whose worker died mid-call rather
  // than stranding it there forever.
  const claim = await prisma.ticket.updateMany({
    where: {
      id: ticketId,
      status: { in: [TicketStatus.new, TicketStatus.processing] },
    },
    data: { status: TicketStatus.processing },
  });
  if (claim.count !== 1) return { status: "superseded" };

  let decision;
  try {
    decision = await resolveTicket({
      subject: ticket.subject,
      body: ticket.messages[0]?.body ?? "",
      requesterName: ticket.requesterName,
    });
  } catch (error) {
    // Never leave a ticket parked in `processing`: it would be invisible to
    // every agent with nothing left running to move it on. A transient failure
    // goes back to `new` so the queue's retry can re-claim it; anything a retry
    // cannot fix goes straight to `open` for a human.
    await releaseClaim(
      ticketId,
      isUnretryable(error) ? TicketStatus.open : TicketStatus.new,
    );
    throw error;
  }

  const threshold = confidenceThreshold();
  const belowThreshold = decision.confidence < threshold;

  if (decision.action === "resolve" && !belowThreshold) {
    return { status: await sendResolution(ticketId, decision) };
  }

  // A confident-sounding "resolve" that came in under the bar is still an
  // escalation — record why, so the agent isn't left guessing.
  const reason =
    decision.action === "resolve" && belowThreshold
      ? `Confidence ${decision.confidence} is below the ${threshold} threshold. ${decision.reason}`
      : decision.reason;

  const { count } = await prisma.ticket.updateMany({
    where: { id: ticketId, status: TicketStatus.processing },
    data: {
      status: TicketStatus.open,
      aiConfidence: decision.confidence,
      aiDecision: reason,
      // The AI is done with it, so it goes back to the shared pool for whoever
      // picks it up. Written in the same statement as the status so an escalated
      // ticket can never be left showing the AI as its owner.
      assignedToId: null,
    },
  });

  return { status: count === 1 ? "escalated" : "superseded" };
}

async function sendResolution(
  ticketId: number,
  decision: { confidence: number; reason: string; reply: string },
): Promise<"resolved" | "superseded"> {
  const support = supportIdentity();

  // The status update runs first and doubles as the guard: if an agent has
  // touched the ticket since it was claimed, the transaction returns before the
  // reply is written, so the student never gets a message the agent didn't
  // expect. No email is sent yet — Mailgun delivery is wired in Phase 4, and
  // this outbound message is exactly what an agent reply records today.
  // One timestamp for both columns: aiResolvedAt records that the model answered
  // it, resolvedAt is what the dashboard measures time-to-resolve from, and they
  // describe the same instant.
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    const { count } = await tx.ticket.updateMany({
      where: { id: ticketId, status: TicketStatus.processing },
      data: {
        status: TicketStatus.resolved,
        aiResolvedAt: now,
        resolvedAt: now,
        aiConfidence: decision.confidence,
        aiDecision: decision.reason,
        // assignedToId is deliberately left alone: the ticket stays assigned to
        // the AI, which is the audit answer to "who answered this?".
      },
    });
    if (count !== 1) return "superseded";

    await tx.message.create({
      data: {
        ticketId,
        direction: "outbound",
        fromEmail: support.email,
        fromName: support.name,
        body: decision.reply,
      },
    });

    return "resolved";
  });
}

// Move a ticket out of the auto-resolve window without running the model, for
// when no job will ever pick it up — the feature is switched off, or the queue
// refused the job. Without this the ticket keeps the `new` it was created with
// and stays hidden from every agent's list forever.
export async function skipAutoResolve(ticketId: number): Promise<void> {
  await prisma.ticket.updateMany({
    where: { id: ticketId, status: TicketStatus.new },
    // No model will ever look at it, so the AI shouldn't be holding it either.
    data: { status: TicketStatus.open, assignedToId: null },
  });
}

async function releaseClaim(
  ticketId: number,
  status: TicketStatus,
): Promise<void> {
  try {
    await prisma.ticket.updateMany({
      where: { id: ticketId, status: TicketStatus.processing },
      // Only the hand-it-to-a-human path releases the assignment. Going back to
      // `new` keeps it: the AI still owns the ticket and the queue's retry will
      // re-claim it.
      data: {
        status,
        ...(status === TicketStatus.open && { assignedToId: null }),
      },
    });
  } catch (error) {
    // The original failure is the one worth propagating — losing it to a
    // secondary database error would hide why the job failed in the first place.
    console.error(
      `Failed to release the auto-resolve claim on ticket ${ticketId}`,
      error,
    );
  }
}
