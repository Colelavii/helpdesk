import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  ticketsQuerySchema,
  createMessageSchema,
  agentTicketStatuses,
  TicketStatus,
  TicketCategory,
} from "@helpdesk/core";
import { requireAuth } from "../require-auth.ts";
import { prisma } from "../prisma.ts";
import { parseBody } from "../parse-body.ts";
import { parseId } from "../parse-id.ts";
import {
  polishReply,
  MissingPolishApiKeyError,
} from "../tickets/polish-reply.ts";
import {
  summarizeTicket,
  MissingSummaryApiKeyError,
} from "../tickets/summarize-ticket.ts";
import type { Prisma } from "../generated/prisma/client.ts";

export const ticketsRouter = Router();

// Tickets are visible to any signed-in staff member (agents and admins).
ticketsRouter.use(requireAuth);

ticketsRouter.get("/", async (req: Request, res: Response) => {
  // Sorting and filtering happen on the server. The schema whitelists sort
  // fields (so the dynamic orderBy key can't be injected) and defaults to
  // newest-first. Filter params are optional — omitting one means "all values".
  const query = parseBody(ticketsQuerySchema, req.query, res);
  if (!query) return;

  // `id` breaks ties so the ordering is total, not just sorted. Without it
  // Postgres is free to return equal rows in any order, and because paging is
  // offset-based (skip/take) that order can differ between the requests for
  // page 1 and page 2 — the same ticket appears on both while another is never
  // shown at all. Ties are the norm, not the exception, when sorting by status
  // or category: five and four distinct values across the whole table.
  //
  // Descending because ids increase with time, so ties resolve newest-first —
  // the same "most recent work first" the default sort gives.
  const orderBy: Prisma.TicketOrderByWithRelationInput[] = [
    { [query.sort]: query.order },
    { id: "desc" },
  ];

  // Build a case-insensitive substring search across subject, requester name,
  // and requester email when a non-empty search string is provided.
  const searchClause: Prisma.TicketWhereInput | undefined =
    query.search
      ? {
          OR: [
            { subject: { contains: query.search, mode: "insensitive" } },
            { requesterName: { contains: query.search, mode: "insensitive" } },
            { requesterEmail: { contains: query.search, mode: "insensitive" } },
          ],
        }
      : undefined;

  // With no status filter the list hides only the window in which the
  // auto-resolve worker still owns the ticket — it hasn't finished deciding, so
  // showing it would put work in front of an agent that may resolve itself a
  // second later, or change status under them while they read it.
  //
  // Once the worker is done the ticket is ordinary history and belongs in the
  // list like any other, whether the AI resolved it or an agent did. Only the
  // in-flight window is hidden, which is why this matches on status alone and
  // ignores `aiResolvedAt` (kept as audit data, and surfaced on the detail
  // page). Filtering by a status explicitly overrides even this, so a ticket
  // mid-decision is still reachable via ?status=processing.
  const defaultScope: Prisma.TicketWhereInput = {
    status: { notIn: [TicketStatus.new, TicketStatus.processing] },
  };

  const where: Prisma.TicketWhereInput = {
    ...(query.status !== undefined ? { status: query.status } : defaultScope),
    ...(query.category !== undefined && { category: query.category }),
    ...searchClause,
  };

  const { page, pageSize } = query;

  // Count + page in one round-trip so `total` is consistent with the slice.
  const [total, tickets] = await prisma.$transaction([
    prisma.ticket.count({ where }),
    prisma.ticket.findMany({
      select: {
        id: true,
        subject: true,
        requesterEmail: true,
        requesterName: true,
        status: true,
        category: true,
        createdAt: true,
        updatedAt: true,
      },
      where,
      orderBy,
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  res.json({ tickets, total, page, pageSize });
});

// Staff a ticket can be assigned to. Any signed-in user may fetch this (it's
// needed to populate the assignee picker), so it's not behind requireAdmin.
// Registered before "/:id" so "assignees" isn't captured as an id.
ticketsRouter.get("/assignees", async (_req: Request, res: Response) => {
  const users = await prisma.user.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, email: true },
    orderBy: { name: "asc" },
  });
  res.json({ users });
});

ticketsRouter.get(
  "/:id",
  async (req: Request<{ id: string }>, res: Response) => {
    const id = parseId(req.params.id, res, "Ticket not found");
    if (id === null) return;

    const ticket = await prisma.ticket.findUnique({
      where: { id },
      select: {
        id: true,
        subject: true,
        requesterEmail: true,
        requesterName: true,
        status: true,
        category: true,
        createdAt: true,
        updatedAt: true,
        // Detail only — the list keeps its select lean.
        aiResolvedAt: true,
        aiConfidence: true,
        aiDecision: true,
        assignedTo: {
          select: { id: true, name: true, email: true },
        },
        messages: {
          select: {
            id: true,
            direction: true,
            fromEmail: true,
            fromName: true,
            body: true,
            createdAt: true,
          },
          orderBy: { createdAt: "asc" }, // oldest first — reads as a thread
        },
      },
    });

    if (!ticket) {
      res.status(404).json({ error: "Ticket not found" });
      return;
    }

    res.json({ ticket });
  },
);

// Partial ticket update. Every field is optional so callers can change any
// subset; `assignedToId`/`category` accept null to clear. `status` is narrowed
// to the statuses an agent owns — `new` and `processing` belong to the
// auto-resolve worker, and hand-setting either would hide the ticket from the
// list with nothing left running to bring it back.
const updateTicketSchema = z.object({
  assignedToId: z.string().min(1).nullable().optional(),
  status: z.enum(agentTicketStatuses).optional(),
  category: z.enum(TicketCategory).nullable().optional(),
});

ticketsRouter.patch(
  "/:id",
  async (req: Request<{ id: string }>, res: Response) => {
    const id = parseId(req.params.id, res, "Ticket not found");
    if (id === null) return;

    const data = parseBody(updateTicketSchema, req.body, res);
    if (!data) return;

    const existing = await prisma.ticket.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      res.status(404).json({ error: "Ticket not found" });
      return;
    }

    // If assigning (not unassigning), the target must be an active user.
    if (data.assignedToId) {
      const assignee = await prisma.user.findFirst({
        where: { id: data.assignedToId, deletedAt: null },
        select: { id: true },
      });
      if (!assignee) {
        res.status(400).json({ error: "Assignee not found" });
        return;
      }
    }

    const ticket = await prisma.ticket.update({
      where: { id },
      // Only touch the fields that were provided (undefined = leave as-is).
      data: {
        ...(data.assignedToId !== undefined && {
          assignedToId: data.assignedToId,
        }),
        ...(data.status !== undefined && { status: data.status }),
        ...(data.category !== undefined && { category: data.category }),
      },
      select: {
        id: true,
        subject: true,
        requesterEmail: true,
        requesterName: true,
        status: true,
        category: true,
        createdAt: true,
        updatedAt: true,
        assignedTo: { select: { id: true, name: true, email: true } },
      },
    });

    res.json({ ticket });
  },
);

// Rewrite an agent's draft reply with the LLM. Nothing is persisted — the
// polished text goes back to the composer for the agent to review and edit.
// The draft reuses createMessageSchema so an empty draft is rejected the same
// way sending one is.
ticketsRouter.post(
  "/:id/polish",
  async (req: Request<{ id: string }>, res: Response) => {
    const id = parseId(req.params.id, res, "Ticket not found");
    if (id === null) return;

    // The polished reply is signed with the signed-in agent's name — the same
    // person who'd be recorded as the sender if they went on to send it.
    const agent = req.user;
    if (!agent) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const data = parseBody(createMessageSchema, req.body, res);
    if (!data) return;

    const ticket = await prisma.ticket.findUnique({
      where: { id },
      select: {
        subject: true,
        requesterName: true,
        messages: {
          select: { direction: true, fromName: true, body: true },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!ticket) {
      res.status(404).json({ error: "Ticket not found" });
      return;
    }

    try {
      const body = await polishReply(data.body, {
        ...ticket,
        agentName: agent.name,
      });
      res.json({ body });
    } catch (error) {
      if (error instanceof MissingPolishApiKeyError) {
        res.status(503).json({ error: "Polishing is not configured." });
        return;
      }
      // The model call failed (rate limit, timeout, upstream outage). The draft
      // is still safe in the composer, so a plain error is enough.
      console.error("Failed to polish reply", error);
      res
        .status(502)
        .json({ error: "The polish service is unavailable right now." });
    }
  },
);

// Summarise a ticket and its conversation with the LLM. Nothing is persisted and
// nothing is cached — every call regenerates, so the summary always reflects the
// thread as it stands. POST (not GET) for that reason: it's a generation action,
// not a fetchable resource.
ticketsRouter.post(
  "/:id/summary",
  async (req: Request<{ id: string }>, res: Response) => {
    const id = parseId(req.params.id, res, "Ticket not found");
    if (id === null) return;

    const ticket = await prisma.ticket.findUnique({
      where: { id },
      select: {
        subject: true,
        requesterName: true,
        status: true,
        category: true,
        messages: {
          select: { direction: true, fromName: true, body: true },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!ticket) {
      res.status(404).json({ error: "Ticket not found" });
      return;
    }

    try {
      const summary = await summarizeTicket(ticket);
      res.json({ summary });
    } catch (error) {
      if (error instanceof MissingSummaryApiKeyError) {
        res.status(503).json({ error: "Summarising is not configured." });
        return;
      }
      // The model call failed (rate limit, timeout, upstream outage) or came
      // back empty. Nothing was persisted, so the agent can simply retry.
      console.error("Failed to summarize ticket", error);
      res
        .status(502)
        .json({ error: "The summary service is unavailable right now." });
    }
  },
);

// Record an agent reply on a ticket. Stored as an outbound message attributed to
// the signed-in agent (direction distinguishes agent replies from student
// mail). No email is sent yet — Mailgun delivery is wired in Phase 4.
ticketsRouter.post(
  "/:id/messages",
  async (req: Request<{ id: string }>, res: Response) => {
    const id = parseId(req.params.id, res, "Ticket not found");
    if (id === null) return;

    // requireAuth guarantees req.user, but it's typed optional — guard for types.
    const agent = req.user;
    if (!agent) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const data = parseBody(createMessageSchema, req.body, res);
    if (!data) return;

    const existing = await prisma.ticket.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!existing) {
      res.status(404).json({ error: "Ticket not found" });
      return;
    }

    const message = await prisma.message.create({
      data: {
        ticketId: id,
        direction: "outbound",
        fromEmail: agent.email,
        fromName: agent.name,
        body: data.body,
        sentById: agent.id,
      },
      select: {
        id: true,
        direction: true,
        fromEmail: true,
        fromName: true,
        body: true,
        createdAt: true,
      },
    });

    res.status(201).json({ message });
  },
);
