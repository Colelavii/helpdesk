import { Router, type Request, type Response } from "express";
import { createUserSchema, updateUserSchema } from "@helpdesk/core";
import { auth } from "../auth.ts";
import { requireAuth } from "../require-auth.ts";
import { requireAdmin } from "../require-admin.ts";
import { prisma } from "../prisma.ts";
import { parseBody } from "../parse-body.ts";

export const usersRouter = Router();

// Every route here is admin-only; resolve the session and authorize once.
usersRouter.use(requireAuth, requireAdmin);

usersRouter.get("/", async (_req: Request, res: Response) => {
  const users = await prisma.user.findMany({
    where: { deletedAt: null },
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
  const data = parseBody(createUserSchema, req.body, res);
  if (!data) return;
  const { name, email, password } = data;

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

usersRouter.patch(
  "/:id",
  async (req: Request<{ id: string }>, res: Response) => {
    const data = parseBody(updateUserSchema, req.body, res);
    if (!data) return;
    const { id } = req.params;
    const { name, email, password } = data;

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    // Better Auth stores emails lowercased; normalize before comparing/looking
    // up so a case-only change isn't mistaken for a real one.
    const normalizedEmail = email.toLowerCase();
    if (normalizedEmail !== existing.email.toLowerCase()) {
      const emailOwner = await prisma.user.findUnique({
        where: { email: normalizedEmail },
      });
      if (emailOwner && emailOwner.id !== id) {
        res
          .status(409)
          .json({ error: "A user with that email already exists" });
        return;
      }
    }

    // updateUser lowercases the email itself; updatePassword writes to the
    // credential account, so it takes a hash (same hasher as create/seed).
    const ctx = await auth.$context;
    const user = await ctx.internalAdapter.updateUser(id, { name, email });
    if (password) {
      await ctx.internalAdapter.updatePassword(
        id,
        await ctx.password.hash(password),
      );
    }

    res.json({
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        createdAt: user.createdAt,
      },
    });
  },
);

usersRouter.delete(
  "/:id",
  async (req: Request<{ id: string }>, res: Response) => {
    const { id } = req.params;

    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing || existing.deletedAt) {
      res.status(404).json({ error: "User not found" });
      return;
    }
    if (existing.role === "admin") {
      res.status(403).json({ error: "Admin users cannot be deleted" });
      return;
    }

    // Soft delete, then revoke active sessions so the user is logged out
    // immediately; the session-create hook blocks any future sign-in.
    await prisma.user.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
    const ctx = await auth.$context;
    await ctx.internalAdapter.deleteUserSessions(id);

    res.json({ success: true });
  },
);
