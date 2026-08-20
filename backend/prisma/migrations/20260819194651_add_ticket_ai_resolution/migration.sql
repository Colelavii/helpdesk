-- AlterEnum
-- Postgres cannot use a newly added enum value in the transaction that adds it,
-- and Prisma wraps each migration in one. So this migration only adds the values
-- and the columns; the follow-up migration sets the new `status` default.

ALTER TYPE "TicketStatus" ADD VALUE 'new';
ALTER TYPE "TicketStatus" ADD VALUE 'processing';

-- AlterTable
ALTER TABLE "ticket" ADD COLUMN     "aiConfidence" DOUBLE PRECISION,
ADD COLUMN     "aiDecision" TEXT,
ADD COLUMN     "aiResolvedAt" TIMESTAMP(3);
