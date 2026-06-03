// The Prisma client is initialized as a singleton in prisma.ts (per CLAUDE.md,
// never instantiate PrismaClient ad hoc). This re-export exposes it as `db`
// for routes/middleware that prefer that name — it's the same single instance.
export { prisma, prisma as db } from "./prisma.ts";
