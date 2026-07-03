import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { screen, within } from "@testing-library/react";
import axios from "axios";
import { TicketStatus, TicketCategory } from "@helpdesk/core";
import TicketsPage from "./TicketsPage";
import { renderWithClient } from "../test/render";

type GetMock = Mock<(url: string, config?: unknown) => Promise<unknown>>;

function mockGet(): GetMock {
  return vi.spyOn(axios, "get") as unknown as GetMock;
}

// The API returns tickets already sorted newest-first; the page renders them in
// the order received.
const sampleTickets = [
  {
    id: 2,
    subject: "Refund for duplicate charge",
    requesterEmail: "newer@example.com",
    requesterName: "Newer Student",
    status: TicketStatus.open,
    category: TicketCategory.refund,
    createdAt: "2024-03-20T10:00:00.000Z",
  },
  {
    id: 1,
    subject: "Cannot log in",
    requesterEmail: "older@example.com",
    requesterName: "Older Student",
    status: TicketStatus.resolved,
    category: null,
    createdAt: "2024-01-15T10:00:00.000Z",
  },
];

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TicketsPage", () => {
  it("shows skeleton placeholders while the request is in flight", () => {
    mockGet().mockReturnValue(new Promise(() => {}));

    const { container } = renderWithClient(<TicketsPage />);

    expect(
      container.querySelectorAll('[data-slot="skeleton"]').length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByRole("columnheader", { name: "Subject" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("No tickets yet.")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders a row for each ticket, in the order returned (newest first)", async () => {
    mockGet().mockResolvedValue({ data: { tickets: sampleTickets } });

    renderWithClient(<TicketsPage />);

    expect(
      await screen.findByText("Refund for duplicate charge"),
    ).toBeInTheDocument();
    expect(screen.getByText("Cannot log in")).toBeInTheDocument();

    // Status/category render verbatim (capitalize is CSS-only); null category
    // shows a dash.
    expect(screen.getByText(TicketStatus.open)).toBeInTheDocument();
    expect(screen.getByText(TicketStatus.resolved)).toBeInTheDocument();
    expect(screen.getByText(TicketCategory.refund)).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();

    expect(
      screen.getByText(
        dateFormatter.format(new Date(sampleTickets[0].createdAt)),
      ),
    ).toBeInTheDocument();

    // The first data row is the newest ticket (as the API returned them).
    const rowGroups = screen.getAllByRole("rowgroup");
    const body = rowGroups[rowGroups.length - 1];
    const rows = within(body).getAllByRole("row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Refund for duplicate charge");
    expect(rows[1]).toHaveTextContent("Cannot log in");
    expect(document.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(0);
  });

  it("shows the empty state when no tickets exist", async () => {
    mockGet().mockResolvedValue({ data: { tickets: [] } });

    renderWithClient(<TicketsPage />);

    expect(await screen.findByText("No tickets yet.")).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("shows an error alert when the request fails", async () => {
    mockGet().mockRejectedValue(new Error("network down"));

    renderWithClient(<TicketsPage />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Unable to load tickets.");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
