import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TicketsPerDay } from "@helpdesk/core";
import TicketsPerDayChart, {
  axisLabelIndexes,
  niceMax,
} from "./TicketsPerDayChart";
import "@testing-library/jest-dom/vitest";

// 30 days ending 2026-08-20, with a deliberate quiet day and a single-ticket day
// so the zero case and the singular label are both covered.
const data: TicketsPerDay[] = Array.from({ length: 30 }, (_, i) => ({
  day: `2026-07-${String(i + 22).padStart(2, "0")}`,
  count: i,
})).map((entry, i) => ({
  day: new Date(Date.UTC(2026, 6, 22 + i)).toISOString().slice(0, 10),
  count: entry.count,
}));

function plot() {
  return screen.getByRole("group", {
    name: /tickets created per day, last 30 days/i,
  });
}

describe("niceMax", () => {
  // The axis top is a number the reader can hold in their head, not the tallest
  // bar's exact count.
  it("rounds up to a readable ceiling", () => {
    expect(niceMax(13)).toBe(15);
    expect(niceMax(16)).toBe(20);
    expect(niceMax(29)).toBe(30);
    expect(niceMax(120)).toBe(125);
  });

  it("never returns zero, so the bar heights can't divide by it", () => {
    expect(niceMax(0)).toBe(1);
    expect(niceMax(-5)).toBe(1);
  });

  it("leaves an exact round value alone", () => {
    expect(niceMax(10)).toBe(10);
    expect(niceMax(5)).toBe(5);
  });
});

describe("axisLabelIndexes", () => {
  it("includes both ends", () => {
    expect(axisLabelIndexes(30)).toContain(0);
    expect(axisLabelIndexes(30)).toContain(29);
  });

  // Regression: a fixed stride left a remainder at the end, so the last interior
  // label landed next to the final one and the two dates overlapped on screen.
  it("never places two labels on adjacent bars", () => {
    for (const length of [5, 7, 14, 28, 29, 30, 31, 45, 90]) {
      const indexes = axisLabelIndexes(length).sort((a, b) => a - b);
      const gaps = indexes.slice(1).map((v, i) => v - indexes[i]);
      expect(Math.min(...gaps), `length ${length}`).toBeGreaterThan(1);
    }
  });

  it("degrades safely for tiny ranges", () => {
    expect(axisLabelIndexes(1)).toEqual([0]);
    expect(axisLabelIndexes(2)).toEqual([0, 1]);
  });
});

describe("TicketsPerDayChart", () => {
  it("shows a skeleton while the data is pending", () => {
    const { container } = render(<TicketsPerDayChart isPending />);

    expect(
      container.querySelectorAll('[data-slot="skeleton"]').length,
    ).toBeGreaterThan(0);
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
  });

  it("renders one hit target per day", () => {
    render(<TicketsPerDayChart data={data} />);

    expect(within(plot()).getAllByRole("button")).toHaveLength(30);
  });

  // Every bar is the same colour: colouring by height would double-encode the
  // value the bar's length already carries.
  it("paints every bar in the single series colour", () => {
    const { container } = render(<TicketsPerDayChart data={data} />);

    expect(container.querySelectorAll(".bg-chart-2")).toHaveLength(30);
    expect(container.querySelectorAll(".bg-primary")).toHaveLength(0);
  });

  // A quiet day has no bar to point at, so the column — not the mark — has to be
  // the hit target, and it still has to report its zero.
  it("keeps a labelled target for a day with no tickets", () => {
    render(<TicketsPerDayChart data={data} />);

    expect(
      within(plot()).getByRole("button", { name: /22 Jul 2026: 0 tickets/i }),
    ).toBeInTheDocument();
  });

  it("uses the singular for a one-ticket day", () => {
    render(<TicketsPerDayChart data={data} />);

    expect(
      within(plot()).getByRole("button", { name: /23 Jul 2026: 1 ticket$/i }),
    ).toBeInTheDocument();
  });

  it("shows the value on hover, with the count leading", async () => {
    const user = userEvent.setup();
    render(<TicketsPerDayChart data={data} />);

    await user.hover(
      within(plot()).getByRole("button", { name: /20 Aug 2026: 29 tickets/i }),
    );

    const tooltip = await screen.findByRole("status");
    expect(tooltip).toHaveTextContent("29 tickets");
    expect(tooltip).toHaveTextContent("20 Aug 2026");
  });

  // "Same details on keyboard focus as on hover" — the chart must not be
  // mouse-only.
  it("shows the same readout on keyboard focus", async () => {
    render(<TicketsPerDayChart data={data} />);

    within(plot())
      .getByRole("button", { name: /20 Aug 2026: 29 tickets/i })
      .focus();

    expect(await screen.findByRole("status")).toHaveTextContent("29 tickets");
  });

  it("highlights the bar being read", async () => {
    const user = userEvent.setup();
    const { container } = render(<TicketsPerDayChart data={data} />);

    await user.hover(within(plot()).getAllByRole("button")[5]);

    expect(container.querySelectorAll(".bg-primary")).toHaveLength(1);
    expect(container.querySelectorAll(".bg-chart-2")).toHaveLength(29);
  });

  // The tooltip enhances but never gates: the table is the way to every value
  // without a pointer.
  it("offers a table view carrying every value", () => {
    render(<TicketsPerDayChart data={data} />);

    const table = screen.getByRole("table");
    // 30 data rows plus the header row.
    expect(within(table).getAllByRole("row")).toHaveLength(31);
    expect(
      within(table).getByRole("columnheader", { name: "Tickets" }),
    ).toBeInTheDocument();
  });

  // 30 dates in the axis band would collide into an unreadable smear.
  it("labels a handful of dates rather than all thirty", () => {
    render(<TicketsPerDayChart data={data} />);

    // The axis band is aria-hidden, so count the rendered date text directly.
    const labels = screen.getAllByText(/^\d+ [A-Z][a-z]{2}$/);
    expect(labels.length).toBeGreaterThanOrEqual(3);
    expect(labels.length).toBeLessThanOrEqual(6);
  });

  it("dims the previous render while refetching instead of flashing", () => {
    const { container } = render(
      <TicketsPerDayChart data={data} isStale />,
    );

    expect(container.firstElementChild).toHaveClass("opacity-60");
    // The bars are still there — no skeleton, no layout jump.
    expect(within(plot()).getAllByRole("button")).toHaveLength(30);
  });
});
