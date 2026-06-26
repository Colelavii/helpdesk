import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { createUserSchema } from "@helpdesk/core";
import { auth } from "../auth.ts";
import { requireAuth } from "../require-auth.ts";
import { requireAdmin } from "../require-admin.ts";
import { prisma } from "../prisma.ts";

export const usersRouter = Router();

// Every route here is admin-only; resolve the session and authorize once.
usersRouter.use(requireAuth, requireAdmin);

usersRouter.get("/", async (_req: Request, res: Response) => {
  const users = await prisma.user.findMany({
    select: {
      id: true,
      name: true,
      email: true,
      role: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });
  res.json({ users });
});

usersRouter.post("/", async (req: Request, res: Response) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: z.flattenError(parsed.error) });
    return;
  }
  const { name, email, password } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    res.status(409).json({ error: "A user with that email already exists" });
    return;
  }

  // Provision via Better Auth's internal adapter (sign-up is disabled): this
  // hashes the password with Better Auth's own hasher and links a credential
  // account, matching the seed script. New users default to the agent role.
  const ctx = await auth.$context;
  const passwordHash = await ctx.password.hash(password);

  const user = await ctx.internalAdapter.createUser({
    email,
    name,
    emailVerified: true,
  });

  await ctx.internalAdapter.linkAccount({
    userId: user.id,
    providerId: "credential",
    accountId: user.id,
    password: passwordHash,
  });

  res.status(201).json({
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      createdAt: user.createdAt,
    },
  });
});
