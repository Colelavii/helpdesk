-- Corrects the backfill in 20260820222909_add_ticket_resolved_at.
--
-- That migration fell back to `updatedAt` for rows the AI hadn't answered. On a
-- row never modified after creation, updatedAt still equals createdAt, so the
-- backfill recorded it as having been resolved the instant it arrived — a zero
-- duration that is not a fast resolution but an absence of evidence, and one
-- that drags the dashboard's average time-to-resolve towards zero.
--
-- Null is the honest value: avg() skips nulls, so the average is computed only
-- from tickets whose resolution time is actually known. A real ticket resolved in
-- the same millisecond it was created does not occur.
UPDATE "ticket"
SET "resolvedAt" = NULL
WHERE "resolvedAt" = "createdAt";
