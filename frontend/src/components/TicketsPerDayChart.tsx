import { useState } from "react";
import type { TicketsPerDay } from "@helpdesk/core";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";

// `day` is a UTC bucket label, so it has to be formatted in UTC too — letting the
// browser's zone interpret it would show yesterday's date on a negative offset.
const labelFormatter = new Intl.DateTimeFormat(undefined, {
  timeZone: "UTC",
  weekday: "short",
  day: "numeric",
  month: "short",
  year: "numeric",
});

const axisFormatter = new Intl.DateTimeFormat(undefined, {
  timeZone: "UTC",
  day: "numeric",
  month: "short",
});

function parseDay(day: string): Date {
  return new Date(`${day}T00:00:00Z`);
}

// Round the axis top up to a readable number so the gridlines land on values a
// reader can hold in their head, rather than on the tallest bar's exact count.
const NICE_STEPS = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10];

export function niceMax(max: number): number {
  if (max <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(max));
  for (const step of NICE_STEPS) {
    const candidate = step * magnitude;
    if (candidate >= max) return candidate;
  }
  return 10 * magnitude;
}

const AXIS_LABEL_COUNT = 5;

// Enough x labels to orient the reader, not one per bar — 30 dates would collide
// into an unreadable band. Spaced evenly *between* the two ends rather than by a
// fixed stride: a stride leaves a remainder, which lands the last interior label
// right next to the final one and the two dates overlap.
export function axisLabelIndexes(
  length: number,
  count = AXIS_LABEL_COUNT,
): number[] {
  if (length <= 1) return [0];
  // Also capped at every-other-bar, so a short range can't be asked for more
  // labels than it has room for without them landing side by side.
  const slots = Math.min(count, Math.max(2, Math.floor((length + 1) / 2)));
  const indexes = new Set<number>();
  for (let i = 0; i < slots; i++) {
    indexes.add(Math.round((i * (length - 1)) / (slots - 1)));
  }
  return [...indexes];
}

const PLOT_HEIGHT = "h-48";

export default function TicketsPerDayChart({
  data,
  isPending = false,
  isStale = false,
}: {
  data?: TicketsPerDay[];
  isPending?: boolean;
  isStale?: boolean;
}) {
  const [active, setActive] = useState<number | null>(null);

  if (isPending || !data) {
    return (
      <div className="space-y-2">
        <Skeleton className={`w-full ${PLOT_HEIGHT}`} />
        <Skeleton className="h-4 w-full" />
      </div>
    );
  }

  const top = niceMax(Math.max(...data.map((d) => d.count), 0));
  const labelled = axisLabelIndexes(data.length);
  const activeDay = active === null ? null : data[active];

  return (
    <div
      // Refetching holds the previous render rather than flashing a skeleton, so
      // the card never jumps.
      className={isStale ? "opacity-60 transition-opacity" : undefined}
    >
      <div className="flex gap-3">
        <div
          className={`flex flex-col justify-between text-xs tabular-nums text-muted-foreground ${PLOT_HEIGHT}`}
          aria-hidden="true"
        >
          <span className="-translate-y-1/2">{top}</span>
          <span className="-translate-y-1/2">{top / 2}</span>
          <span className="-translate-y-1/2">0</span>
        </div>

        <div className="relative flex-1">
          {/* Solid hairlines one step off the surface — present to be read past,
              not to be looked at. */}
          <div
            className={`absolute inset-x-0 top-0 flex flex-col justify-between ${PLOT_HEIGHT}`}
            aria-hidden="true"
          >
            <div className="border-t border-border" />
            <div className="border-t border-border" />
            <div className="border-t border-border" />
          </div>

          <div
            className={`relative flex items-end gap-0.5 ${PLOT_HEIGHT}`}
            role="group"
            aria-label="Tickets created per day, last 30 days"
          >
            {data.map((entry, i) => (
              <button
                key={entry.day}
                type="button"
                // The hit target is the whole column, not the painted bar: a
                // quiet day's bar is only a pixel or two tall.
                className="flex h-full flex-1 cursor-default items-end justify-center rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                onMouseEnter={() => setActive(i)}
                onMouseLeave={() => setActive((c) => (c === i ? null : c))}
                onFocus={() => setActive(i)}
                onBlur={() => setActive((c) => (c === i ? null : c))}
                aria-label={`${labelFormatter.format(parseDay(entry.day))}: ${entry.count} ${entry.count === 1 ? "ticket" : "tickets"}`}
              >
                <span
                  // 4px is the mark spec, not a theme radius — the scale's
                  // nearest tokens are 6px and 10px, and 10px on a bar this
                  // narrow reads as a lollipop. Square at the baseline.
                  className={`w-full max-w-6 rounded-t-[4px] transition-colors ${
                    active === i ? "bg-primary" : "bg-chart-2"
                  }`}
                  style={{ height: `${(entry.count / top) * 100}%` }}
                />
              </button>
            ))}
          </div>

          {activeDay && (
            <div
              // Pinned inside the plot so the card's overflow can never clip it,
              // and nudged to whichever side keeps it in frame at the edges.
              className={`pointer-events-none absolute top-0 z-10 w-max rounded-md bg-popover px-2.5 py-1.5 shadow-md ring-1 ring-border ${
                active !== null && active < 3
                  ? "left-0"
                  : active !== null && active > data.length - 4
                    ? "right-0"
                    : "-translate-x-1/2"
              }`}
              style={
                active !== null && active >= 3 && active <= data.length - 4
                  ? { left: `${((active + 0.5) / data.length) * 100}%` }
                  : undefined
              }
              role="status"
            >
              {/* The reader already knows the date they pointed at; they came for
                  the number, so it leads. */}
              <p className="text-sm font-semibold text-popover-foreground">
                {activeDay.count}{" "}
                {activeDay.count === 1 ? "ticket" : "tickets"}
              </p>
              <p className="text-xs text-muted-foreground">
                {labelFormatter.format(parseDay(activeDay.day))}
              </p>
            </div>
          )}

          <div className="mt-2 flex gap-0.5" aria-hidden="true">
            {data.map((entry, i) => (
              <div
                key={entry.day}
                className={`flex-1 text-xs whitespace-nowrap text-muted-foreground ${
                  i === 0
                    ? "text-left"
                    : i === data.length - 1
                      ? "text-right"
                      : "text-center"
                }`}
              >
                {labelled.includes(i)
                  ? axisFormatter.format(parseDay(entry.day))
                  : null}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* The hover tooltip enhances; it never gates. Every value is also here. */}
      <details className="mt-4">
        <summary className="cursor-pointer text-sm text-muted-foreground hover:text-foreground">
          Show as table
        </summary>
        <div className="mt-2 max-h-64 overflow-y-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Day</TableHead>
                <TableHead className="text-right">Tickets</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((entry) => (
                <TableRow key={entry.day}>
                  <TableCell>
                    {labelFormatter.format(parseDay(entry.day))}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {entry.count}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </details>
    </div>
  );
}
