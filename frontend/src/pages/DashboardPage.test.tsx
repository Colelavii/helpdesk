import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { screen } from "@testing-library/react";
import axios from "axios";
import type { TicketStats, TicketsPerDay } from "@helpdesk/core";
import DashboardPage from "./DashboardPage";
import { renderWithClient } from "../test/render";

// axios.get is heavily overloaded; cast the spy to a loose signature so the
// mock helpers don't fight the overload resolution.
type GetMock = Mock<(url: string, config?: unknown) => Promise<unknown>>;

function mockGet(): GetMock {
  return vi.spyOn(axios, "get") as unknown as GetMock;
}

const sampleStats: TicketStats = {
  total: 128,
  open: 34,
  concluded: 88,
  aiResolved: 61,
  aiResolvedPercent: 69.3,
  averageResolutionMinutes: 142.5,
};

// An untouched helpdesk: both derived figures are null rather than zero.
const emptyStats: TicketStats = {
  total: 0,
  open: 0,
  concluded: 0,
  aiResolved: 0,
  aiResolvedPercent: null,
  averageResolutionMinutes: null,
};

const sampleDaily: TicketsPerDay[] = Array.from({ length: 30 }, (_, i) => ({
  day: `2026-08-${String(i + 1).padStart(2, "0")}`,
  count: i,
}));

function payload(stats: TicketStats, daily: TicketsPerDay[] = sampleDaily) {
  return { data: { stats, daily } };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("DashboardPage", () => {
  it("shows skeleton placeholders while the request is in flight", () => {
    // A promise that never resolves keeps the query in its pending state.
    mockGet().mockReturnValue(new Promise(() => {}));

    const { container } = renderWithClient(<DashboardPage />);

    expect(
      container.querySelectorAll('[data-slot="skeleton"]').length,
    ).toBeGreaterThan(0);
    // The tile labels render alongside the skeletons.
    expect(screen.getByText("Total tickets")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reads the figures from the stats endpoint", async () => {
    const get = mockGet().mockResolvedValue(payload(sampleStats));

    renderWithClient(<DashboardPage />);
    await screen.findByText("128");

    expect(get.mock.calls[0]?.[0]).toBe("/api/tickets/stats");
  });

  it("renders all five figures", async () => {
    mockGet().mockResolvedValue(payload(sampleStats));

    renderWithClient(<DashboardPage />);

    expect(await screen.findByText("128")).toBeInTheDocument();
    expect(screen.getByText("34")).toBeInTheDocument();
    expect(screen.getByText("61")).toBeInTheDocument();
    expect(screen.getByText("69.3%")).toBeInTheDocument();
    // 142.5 minutes, formatted.
    expect(screen.getByText("2h 23m")).toBeInTheDocument();
  });

  // The percentage is over concluded tickets, not the total, so the hint has to
  // name the ratio it came from or the number can't be checked.
  it("shows the ratio behind the AI percentage", async () => {
    mockGet().mockResolvedValue(payload(sampleStats));

    renderWithClient(<DashboardPage />);

    expect(
      await screen.findByText("61 of 88 concluded tickets"),
    ).toBeInTheDocument();
  });

  // "0%" and "0m" would be claims the data doesn't support.
  it("renders an em dash for both derived figures on an empty helpdesk", async () => {
    mockGet().mockResolvedValue(payload(emptyStats));

    renderWithClient(<DashboardPage />);
    await screen.findByText("0 of 0 concluded tickets");

    expect(screen.getAllByText("—")).toHaveLength(2);
  });

  it("replaces the whole grid with one error when the request fails", async () => {
    mockGet().mockRejectedValue(new Error("network down"));

    renderWithClient(<DashboardPage />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Unable to load dashboard statistics.");
    // One message for the page, not one per tile.
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.queryByText("Total tickets")).not.toBeInTheDocument();
  });
});
