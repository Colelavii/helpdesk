import { Router, type Request, type Response } from "express";
import { ticketsQuerySchema } from "@helpdesk/core";
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

  const tickets = await prisma.ticket.findMany({
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
  });
  res.json({ tickets });
});
