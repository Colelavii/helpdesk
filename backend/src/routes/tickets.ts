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
  // Sorting happens on the server. The schema whitelists sort fields (so the
  // dynamic orderBy key can't be injected) and defaults to newest-first.
  const query = parseBody(ticketsQuerySchema, req.query, res);
  if (!query) return;

  const orderBy: Prisma.TicketOrderByWithRelationInput = {
    [query.sort]: query.order,
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
    orderBy,
  });
  res.json({ tickets });
});
