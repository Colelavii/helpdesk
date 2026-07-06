import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axios from "axios";
import { TicketStatus, TicketCategory } from "@helpdesk/core";
import TicketsPage from "./TicketsPage";
import { renderWithClient } from "../test/render";

type GetMock = Mock<(url: string, config?: unknown) => Promise<unknown>>;

function mockGet(): GetMock {
  return vi.spyOn(axios, "get") as unknown as GetMock;
}

// The API returns tickets already sorted (server-side); the page renders them in
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
    // The (now sortable) column header still renders alongside the skeletons.
    expect(
      screen.getByRole("columnheader", { name: /subject/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText("No tickets yet.")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders a row for each ticket, in the order returned (server-sorted)", async () => {
    mockGet().mockResolvedValue({ data: { tickets: sampleTickets } });

    renderWithClient(<TicketsPage />);

    expect(
      await screen.findByText("Refund for duplicate charge"),
    ).toBeInTheDocument();
    expect(screen.getByText("Cannot log in")).toBeInTheDocument();

    expect(screen.getByText(TicketStatus.open)).toBeInTheDocument();
    expect(screen.getByText(TicketStatus.resolved)).toBeInTheDocument();
    expect(screen.getByText(TicketCategory.refund)).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();

    expect(
      screen.getByText(
        dateFormatter.format(new Date(sampleTickets[0].createdAt)),
      ),
    ).toBeInTheDocument();

    // Rows appear in the order the API returned them.
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

describe("TicketsPage — server-side sorting", () => {
  it("requests the default sort (createdAt desc) on initial load", async () => {
    const get = mockGet().mockResolvedValue({ data: { tickets: sampleTickets } });

    renderWithClient(<TicketsPage />);
    await screen.findByText("Refund for duplicate charge");

    expect(get).toHaveBeenLastCalledWith(
      "/api/tickets",
      expect.objectContaining({ params: { sort: "createdAt", order: "desc" } }),
    );
  });

  it("re-fetches with the sort params when a column header is clicked", async () => {
    const get = mockGet().mockResolvedValue({ data: { tickets: sampleTickets } });
    const user = userEvent.setup();

    renderWithClient(<TicketsPage />);
    await screen.findByText("Refund for duplicate charge");

    const subjectHeader = screen.getByRole("button", { name: /sort by subject/i });

    // First click on a string column → ascending.
    await user.click(subjectHeader);
    await waitFor(() =>
      expect(get).toHaveBeenLastCalledWith(
        "/api/tickets",
        expect.objectContaining({ params: { sort: "subject", order: "asc" } }),
      ),
    );

    // Second click → descending.
    await user.click(subjectHeader);
    await waitFor(() =>
      expect(get).toHaveBeenLastCalledWith(
        "/api/tickets",
        expect.objectContaining({ params: { sort: "subject", order: "desc" } }),
      ),
    );
  });
});
