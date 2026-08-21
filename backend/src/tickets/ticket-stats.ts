import type { TicketStats, TicketsPerDay } from "@helpdesk/core";
import { prisma } from "../prisma.ts";

// The row the aggregate query returns, before the derived figures are added.
interface StatsRow {
  total: number;
  open: number;
  concluded: number;
  aiResolved: number;
  avgResolutionSeconds: number | null;
}

// One row of the per-day query. Structurally identical to TicketsPerDay, but
// kept separate on purpose: this describes what comes back from the driver, and
// ticketsPerDay coerces it before promising the shared shape to a caller.
interface PerDayRow {
  day: string;
  count: number;
}

// The dashboard's five headline figures.
//
// Raw SQL rather than Prisma aggregates because Prisma cannot AVG a date
// difference, and once that one query is unavoidable, four separate counts
// alongside it would be five statements and two mechanisms for less. This is one
// statement and one table scan. There is no user input in the template, so
// nothing to parameterise.
export async function ticketStats(): Promise<TicketStats> {
  const rows = await prisma.$queryRaw<StatsRow[]>`
    SELECT
      count(*)::int                                                 AS "total",
      count(*) FILTER (WHERE status = 'open')::int                   AS "open",
      count(*) FILTER (WHERE status IN ('resolved','closed'))::int    AS "concluded",
      count(*) FILTER (WHERE "aiResolvedAt" IS NOT NULL
                         AND status IN ('resolved','closed'))::int    AS "aiResolved",
      avg(extract(epoch FROM ("resolvedAt" - "createdAt")))::float8  AS "avgResolutionSeconds"
    FROM "ticket"
  `;

  // The casts above matter: the pg driver hands back bigint for count() (which
  // JSON.stringify throws on) and a string for numeric. Coerce anyway rather
  // than trusting the cast — a wrong type here would surface as "NaN" in the UI.
  const row = rows[0];
  const total = Number(row?.total ?? 0);
  const open = Number(row?.open ?? 0);
  const concluded = Number(row?.concluded ?? 0);
  const aiResolved = Number(row?.aiResolved ?? 0);

  // avg() over no rows is NULL, and the subtraction is NULL wherever resolvedAt
  // is — so this is null exactly when nothing has been resolved.
  const seconds = row?.avgResolutionSeconds;
  const averageResolutionMinutes =
    seconds === null || seconds === undefined
      ? null
      : Math.round(Number(seconds) / 6) / 10;

  return {
    total,
    open,
    concluded,
    aiResolved,
    aiResolvedPercent:
      concluded === 0 ? null : Math.round((aiResolved / concluded) * 1000) / 10,
    averageResolutionMinutes,
  };
}

export const ticketsPerDayWindow = 30;

// Tickets created per day over the trailing 30 days, oldest first.
//
// generate_series drives the result rather than the ticket rows, so a day with no
// tickets still comes back as a 0 instead of vanishing — grouping the table alone
// would silently close the gap and misdate every bar after it.
//
// Bucketed in UTC, which is what the column holds: `current_date` would bucket by
// whatever timezone the database session happens to be in, quietly splitting one
// day's intake across two bars on a server that isn't on UTC. `to_char` returns
// the label as text for the same reason — a date would be re-read in the
// browser's timezone and could shift a bar.
export async function ticketsPerDay(): Promise<TicketsPerDay[]> {
  const rows = await prisma.$queryRaw<PerDayRow[]>`
    WITH days AS (
      SELECT generate_series(
        -- The ::int cast is required: the driver binds the parameter as bigint,
        -- and make_interval has no bigint overload.
        date_trunc('day', now() AT TIME ZONE 'utc')
          - make_interval(days => ${ticketsPerDayWindow - 1}::int),
        date_trunc('day', now() AT TIME ZONE 'utc'),
        interval '1 day'
      ) AS day
    )
    SELECT
      to_char(days.day, 'YYYY-MM-DD') AS "day",
      count(t.id)::int                AS "count"
    FROM days
    LEFT JOIN "ticket" t
      ON t."createdAt" >= days.day
     AND t."createdAt" <  days.day + interval '1 day'
    GROUP BY days.day
    ORDER BY days.day
  `;

  return rows.map((row) => ({ day: row.day, count: Number(row.count) }));
}
