import { beforeEach, describe, expect, it, mock } from "bun:test";

// Only the Prisma singleton is stubbed: the aggregation itself is one SQL
// statement Postgres runs, so what's worth testing here is the arithmetic on top
// of it — the two derived figures, and the coercion that protects them from the
// driver's return types.
type Row = Record<string, unknown>;

let rows: Row[] = [];
let queryCalls = 0;

mock.module("../prisma.ts", () => ({
  prisma: {
    $queryRaw: async () => {
      queryCalls += 1;
      return rows;
    },
  },
}));

const { ticketStats, ticketsPerDay, ticketsPerDayWindow } = await import(
  "./ticket-stats.ts"
);

function row(overrides: Row = {}): Row {
  return {
    total: 128,
    open: 34,
    concluded: 88,
    aiResolved: 61,
    avgResolutionSeconds: 8_550,
    ...overrides,
  };
}

beforeEach(() => {
  rows = [row()];
  queryCalls = 0;
});

describe("ticketStats", () => {
  it("passes the raw counts straight through", async () => {
    expect(await ticketStats()).toMatchObject({
      total: 128,
      open: 34,
      concluded: 88,
      aiResolved: 61,
    });
  });

  it("takes all five figures from a single query", async () => {
    await ticketStats();

    expect(queryCalls).toBe(1);
  });

  it("reports the AI share of concluded tickets to one decimal place", async () => {
    // 61/88 = 69.3181…
    expect((await ticketStats()).aiResolvedPercent).toBe(69.3);
  });

  it("converts the average from seconds to minutes", async () => {
    // 8550s = 142.5 min
    expect((await ticketStats()).averageResolutionMinutes).toBe(142.5);
  });

  // Null, not 0: "the AI resolved 0% of them" is a claim about the model, and
  // there is nothing here to make it about.
  it("reports no AI percentage when nothing has concluded", async () => {
    rows = [row({ concluded: 0, aiResolved: 0 })];

    expect((await ticketStats()).aiResolvedPercent).toBeNull();
  });

  // avg() over zero rows is NULL, which is what an empty helpdesk looks like.
  it("reports no average when nothing has been resolved", async () => {
    rows = [row({ avgResolutionSeconds: null })];

    expect((await ticketStats()).averageResolutionMinutes).toBeNull();
  });

  // The query casts counts to int and the average to float8 precisely because the
  // pg driver hands back BigInt and string otherwise. Coerce anyway — a leaked
  // string would surface as "NaN" on the dashboard.
  it("coerces numeric values the driver returns as strings", async () => {
    rows = [
      row({
        total: "128",
        open: "34",
        concluded: "88",
        aiResolved: "61",
        avgResolutionSeconds: "8550",
      }),
    ];

    expect(await ticketStats()).toEqual({
      total: 128,
      open: 34,
      concluded: 88,
      aiResolved: 61,
      aiResolvedPercent: 69.3,
      averageResolutionMinutes: 142.5,
    });
  });

  // Defensive: the query always returns exactly one row, but reading [0] off an
  // empty result must not produce a dashboard full of NaN.
  it("reports zeroes rather than NaN if the result comes back empty", async () => {
    rows = [];

    expect(await ticketStats()).toEqual({
      total: 0,
      open: 0,
      concluded: 0,
      aiResolved: 0,
      aiResolvedPercent: null,
      averageResolutionMinutes: null,
    });
  });
});

describe("ticketsPerDay", () => {
  it("covers a 30-day window", () => {
    expect(ticketsPerDayWindow).toBe(30);
  });

  it("returns the rows in the order the query produced them", async () => {
    rows = [
      { day: "2026-08-18", count: 0 },
      { day: "2026-08-19", count: 4 },
      { day: "2026-08-20", count: 13 },
    ];

    expect(await ticketsPerDay()).toEqual([
      { day: "2026-08-18", count: 0 },
      { day: "2026-08-19", count: 4 },
      { day: "2026-08-20", count: 13 },
    ]);
  });

  // The day label is deliberately text, not a Date: serializing a date here would
  // let the browser's timezone shift a ticket into the neighbouring bar.
  it("keeps the day as a plain string", async () => {
    rows = [{ day: "2026-08-20", count: 1 }];

    const [first] = await ticketsPerDay();
    expect(typeof first?.day).toBe("string");
    expect(first?.day).toBe("2026-08-20");
  });

  it("coerces a count the driver returns as a string", async () => {
    rows = [{ day: "2026-08-20", count: "7" }];

    expect(await ticketsPerDay()).toEqual([{ day: "2026-08-20", count: 7 }]);
  });

  it("issues one query", async () => {
    rows = [{ day: "2026-08-20", count: 1 }];

    await ticketsPerDay();

    expect(queryCalls).toBe(1);
  });
});
