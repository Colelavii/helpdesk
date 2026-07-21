import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { ticketsQuerySchema, TicketStatus, TicketCategory } from "@helpdesk/core";
import { requireAuth } from "../require-auth.ts";
import { prisma } from "../prisma.ts";
import { parseBody } from "../parse-body.ts";
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

  const orderBy: Prisma.TicketOrderByWithRelationInput = {
    [query.sort]: query.order,
  };

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

  const where: Prisma.TicketWhereInput = {
    ...(query.status !== undefined && { status: query.status }),
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
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(404).json({ error: "Ticket not found" });
      return;
    }

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
// subset; `assignedToId`/`category` accept null to clear.
const updateTicketSchema = z.object({
  assignedToId: z.string().min(1).nullable().optional(),
  status: z.enum(TicketStatus).optional(),
  category: z.enum(TicketCategory).nullable().optional(),
});

ticketsRouter.patch(
  "/:id",
  async (req: Request<{ id: string }>, res: Response) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) {
      res.status(404).json({ error: "Ticket not found" });
      return;
    }

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
