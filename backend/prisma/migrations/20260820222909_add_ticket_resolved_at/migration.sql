-- AlterTable
ALTER TABLE "ticket" ADD COLUMN     "resolvedAt" TIMESTAMP(3);

-- Backfill from the best evidence already on the row: aiResolvedAt is exact
-- where the worker answered it, and updatedAt is the closest proxy for an
-- agent-resolved row. Deliberately only `resolved` rows -- a `closed` ticket may
-- have been closed without ever being answered, and inventing a resolution time
-- for it would skew the average time-to-resolve.
UPDATE "ticket"
SET "resolvedAt" = COALESCE("aiResolvedAt", "updatedAt")
WHERE "status" = 'resolved';
