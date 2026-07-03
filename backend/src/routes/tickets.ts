import { Router, type Request, type Response } from "express";
import { requireAuth } from "../require-auth.ts";
import { prisma } from "../prisma.ts";

export const ticketsRouter = Router();

// Tickets are visible to any signed-in staff member (agents and admins).
ticketsRouter.use(requireAuth);

ticketsRouter.get("/", async (_req: Request, res: Response) => {
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
    orderBy: { createdAt: "desc" }, // newest first
  });
  res.json({ tickets });
});
