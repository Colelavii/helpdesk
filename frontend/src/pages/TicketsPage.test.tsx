import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axios from "axios";
import {
  TicketStatus,
  TicketCategory,
  ticketSearchMaxLength,
  type Ticket,
} from "@helpdesk/core";
import TicketsPage from "./TicketsPage";
import TicketsTable, { type TicketFilters } from "@/components/TicketsTable";
import { renderWithClient } from "../test/render";

type GetMock = Mock<(url: string, config?: unknown) => Promise<unknown>>;

function mockGet(): GetMock {
  return vi.spyOn(axios, "get") as unknown as GetMock;
}

const sampleTickets: Ticket[] = [
  {
    id: 2,
    subject: "Refund for duplicate charge",
    requesterEmail: "newer@example.com",
    requesterName: "Newer Student",
    status: TicketStatus.open,
    category: TicketCategory.refund,
    createdAt: "2024-03-20T10:00:00.000Z",
    updatedAt: "2024-03-20T10:00:00.000Z",
  },
  {
    id: 1,
    subject: "Cannot log in",
    requesterEmail: "older@example.com",
    requesterName: "Older Student",
    status: TicketStatus.resolved,
    category: null,
    createdAt: "2024-01-15T10:00:00.000Z",
    updatedAt: "2024-01-15T10:00:00.000Z",
  },
];

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ─── Core page behaviour ──────────────────────────────────────────────────────

describe("TicketsPage", () => {
  it("shows skeleton placeholders while the request is in flight", () => {
    mockGet().mockReturnValue(new Promise(() => {}));

    const { container } = renderWithClient(<TicketsPage />);

    expect(
      container.querySelectorAll('[data-slot="skeleton"]').length,
    ).toBeGreaterThan(0);
    expect(
      screen.getByRole("columnheader", { name: /subject/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("No tickets match the current filters."),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders a row for each ticket in the order returned", async () => {
    mockGet().mockResolvedValue({ data: { tickets: sampleTickets, total: sampleTickets.length } });

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

    const rowGroups = screen.getAllByRole("rowgroup");
    const body = rowGroups[rowGroups.length - 1];
    const rows = within(body).getAllByRole("row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Refund for duplicate charge");
    expect(rows[1]).toHaveTextContent("Cannot log in");
    expect(document.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(0);

    // The subject links to that ticket's detail page.
    expect(
      screen.getByRole("link", { name: "Refund for duplicate charge" }),
    ).toHaveAttribute("href", "/tickets/2");
  });

  // The auto-resolve statuses are filtered out of the default list by the
  // server, so these rows only appear when someone filters for them — but the
  // table still has to label them rather than rendering a blank badge.
  it("renders a badge for the auto-resolve statuses", async () => {
    mockGet().mockResolvedValue({
      data: {
        tickets: [
          { ...sampleTickets[0], id: 3, status: TicketStatus.new },
          { ...sampleTickets[1], id: 4, status: TicketStatus.processing },
        ],
        total: 2,
      },
    });

    renderWithClient(<TicketsPage />);

    expect(await screen.findByText(TicketStatus.new)).toBeInTheDocument();
    expect(screen.getByText(TicketStatus.processing)).toBeInTheDocument();
  });

  it("shows the empty state inside the table when the API returns no tickets", async () => {
    mockGet().mockResolvedValue({ data: { tickets: [], total: 0 } });

    renderWithClient(<TicketsPage />);

    await screen.findByText("No tickets match the current filters.");
    expect(screen.getByRole("table")).toBeInTheDocument();
  });

  it("shows an error alert when the request fails", async () => {
    mockGet().mockRejectedValue(new Error("network down"));

    renderWithClient(<TicketsPage />);

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Unable to load tickets.");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});

// ─── Sorting ──────────────────────────────────────────────────────────────────

describe("TicketsPage — server-side sorting", () => {
  it("requests the default sort (createdAt desc) on initial load", async () => {
    const get = mockGet().mockResolvedValue({ data: { tickets: sampleTickets, total: sampleTickets.length } });

    renderWithClient(<TicketsPage />);
    await screen.findByText("Refund for duplicate charge");

    expect(get).toHaveBeenLastCalledWith(
      "/api/tickets",
      expect.objectContaining({
        params: expect.objectContaining({ sort: "createdAt", order: "desc" }),
      }),
    );
  });

  it("re-fetches with sort params when a column header is clicked", async () => {
    const get = mockGet().mockResolvedValue({ data: { tickets: sampleTickets, total: sampleTickets.length } });
    const user = userEvent.setup();

    renderWithClient(<TicketsPage />);
    await screen.findByText("Refund for duplicate charge");

    const subjectHeader = screen.getByRole("button", { name: /sort by subject/i });

    await user.click(subjectHeader);
    await waitFor(() =>
      expect(get).toHaveBeenLastCalledWith(
        "/api/tickets",
        expect.objectContaining({
          params: expect.objectContaining({ sort: "subject", order: "asc" }),
        }),
      ),
    );

    await user.click(subjectHeader);
    await waitFor(() =>
      expect(get).toHaveBeenLastCalledWith(
        "/api/tickets",
        expect.objectContaining({
          params: expect.objectContaining({ sort: "subject", order: "desc" }),
        }),
      ),
    );
  });
});

// ─── Filtering (selects) ──────────────────────────────────────────────────────

describe("TicketsPage — server-side filtering (API params)", () => {
  it("requests only sort params when no filter is active", async () => {
    const get = mockGet().mockResolvedValue({ data: { tickets: sampleTickets, total: sampleTickets.length } });

    renderWithClient(<TicketsPage />);
    await screen.findByText("Refund for duplicate charge");

    expect(get).toHaveBeenLastCalledWith(
      "/api/tickets",
      expect.objectContaining({
        params: expect.objectContaining({ sort: "createdAt", order: "desc" }),
      }),
    );
  });

  it("filter controls are present on initial render", async () => {
    mockGet().mockResolvedValue({ data: { tickets: sampleTickets, total: sampleTickets.length } });

    renderWithClient(<TicketsPage />);
    await screen.findByText("Refund for duplicate charge");

    expect(
      screen.getByRole("searchbox", { name: /search tickets/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: /filter by status/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: /filter by category/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /clear all filters/i }),
    ).not.toBeInTheDocument();
  });
});

// ─── Search input ─────────────────────────────────────────────────────────────

describe("TicketsPage — search", () => {
  it("re-fetches with search param after debounce when text is typed", async () => {
    const get = mockGet().mockResolvedValue({ data: { tickets: sampleTickets, total: sampleTickets.length } });
    const user = userEvent.setup();

    renderWithClient(<TicketsPage />);
    await screen.findByText("Refund for duplicate charge");

    const searchInput = screen.getByRole("searchbox", { name: /search tickets/i });
    await user.type(searchInput, "refund");

    // Debounced (300 ms): the search param isn't sent immediately on keystroke.
    expect(get).not.toHaveBeenCalledWith(
      "/api/tickets",
      expect.objectContaining({
        params: expect.objectContaining({ search: "refund" }),
      }),
    );

    // Once the debounce settles, the query refetches with the search param.
    await waitFor(
      () =>
        expect(get).toHaveBeenLastCalledWith(
          "/api/tickets",
          expect.objectContaining({
            params: expect.objectContaining({ search: "refund" }),
          }),
        ),
      { timeout: 2000 },
    );
  });

  it("does not include search param when the input is cleared", async () => {
    const get = mockGet().mockResolvedValue({ data: { tickets: sampleTickets, total: sampleTickets.length } });
    const user = userEvent.setup();

    renderWithClient(<TicketsPage />);
    await screen.findByText("Refund for duplicate charge");

    const searchInput = screen.getByRole("searchbox", { name: /search tickets/i });

    // Type a term and wait for it to settle into a request.
    await user.type(searchInput, "login");
    await waitFor(
      () =>
        expect(get).toHaveBeenLastCalledWith(
          "/api/tickets",
          expect.objectContaining({
            params: expect.objectContaining({ search: "login" }),
          }),
        ),
      { timeout: 2000 },
    );

    // Clearing it drops the search param from the next request.
    await user.clear(searchInput);
    await waitFor(
      () =>
        expect(get).toHaveBeenLastCalledWith(
          "/api/tickets",
          expect.objectContaining({
            params: expect.not.objectContaining({ search: expect.anything() }),
          }),
        ),
      { timeout: 2000 },
    );
  });
});

// ─── Filter bar unit tests (TicketsTable directly) ────────────────────────────

describe("TicketsTable — filter bar rendering", () => {
  const noop = () => {};
  const defaultProps = {
    tickets: sampleTickets,
    sorting: [{ id: "createdAt", desc: true }],
    onSortingChange: () => {},
    filters: {} as TicketFilters,
    onFiltersChange: noop,
    pagination: { pageIndex: 0, pageSize: 20 },
    onPaginationChange: () => {},
    pageCount: 1,
    total: sampleTickets.length,
  };

  it("renders the search input and both filter comboboxes", () => {
    renderWithClient(<TicketsTable {...defaultProps} />);

    expect(
      screen.getByRole("searchbox", { name: /search tickets/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: /filter by status/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: /filter by category/i }),
    ).toBeInTheDocument();
  });

  it("does not show Clear button when no filters are active", () => {
    renderWithClient(<TicketsTable {...defaultProps} />);

    expect(
      screen.queryByRole("button", { name: /clear all filters/i }),
    ).not.toBeInTheDocument();
  });

  it("shows Clear button when a status filter is active", () => {
    renderWithClient(
      <TicketsTable {...defaultProps} filters={{ status: TicketStatus.open }} />,
    );
    expect(
      screen.getByRole("button", { name: /clear all filters/i }),
    ).toBeInTheDocument();
  });

  it("shows Clear button when a category filter is active", () => {
    renderWithClient(
      <TicketsTable
        {...defaultProps}
        filters={{ category: TicketCategory.technical }}
      />,
    );
    expect(
      screen.getByRole("button", { name: /clear all filters/i }),
    ).toBeInTheDocument();
  });

  it("shows Clear button when a search term is active", () => {
    renderWithClient(
      <TicketsTable {...defaultProps} filters={{ search: "login" }} />,
    );
    expect(
      screen.getByRole("button", { name: /clear all filters/i }),
    ).toBeInTheDocument();
  });

  it("calls onFiltersChange with empty object when Clear is clicked", async () => {
    const onFiltersChange = vi.fn();
    const user = userEvent.setup();

    renderWithClient(
      <TicketsTable
        {...defaultProps}
        filters={{ status: TicketStatus.open, search: "refund" }}
        onFiltersChange={onFiltersChange}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: /clear all filters/i }),
    );

    expect(onFiltersChange).toHaveBeenCalledWith({});
  });

  it("calls onFiltersChange with updated search when text is typed", async () => {
    const onFiltersChange = vi.fn();
    const user = userEvent.setup();

    renderWithClient(
      <TicketsTable
        {...defaultProps}
        onFiltersChange={onFiltersChange}
      />,
    );

    const searchInput = screen.getByRole("searchbox", { name: /search tickets/i });
    await user.type(searchInput, "a");

    expect(onFiltersChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ search: "a" }),
    );
  });

  it("calls onFiltersChange with search undefined when input is cleared", async () => {
    const onFiltersChange = vi.fn();
    const user = userEvent.setup();

    renderWithClient(
      <TicketsTable
        {...defaultProps}
        filters={{ search: "login" }}
        onFiltersChange={onFiltersChange}
      />,
    );

    const searchInput = screen.getByRole("searchbox", { name: /search tickets/i });
    await user.clear(searchInput);

    expect(onFiltersChange).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ search: expect.anything() }),
    );
  });

  // The server rejects a search longer than this, which would surface as the
  // list's error state — the input has to stop typing at the same limit.
  it("caps the search input at the length the server accepts", () => {
    renderWithClient(<TicketsTable {...defaultProps} />);

    expect(
      screen.getByRole("searchbox", { name: /search tickets/i }),
    ).toHaveAttribute("maxlength", String(ticketSearchMaxLength));
  });

  it("shows empty-filter message in table body when tickets array is empty", () => {
    renderWithClient(<TicketsTable {...defaultProps} tickets={[]} />);

    expect(
      screen.getByText("No tickets match the current filters."),
    ).toBeInTheDocument();
  });
});

// ─── Pagination ───────────────────────────────────────────────────────────────

describe("TicketsPage — server-side pagination", () => {
  it("sends page and pageSize params on initial load", async () => {
    const get = mockGet().mockResolvedValue({
      data: { tickets: sampleTickets, total: sampleTickets.length },
    });

    renderWithClient(<TicketsPage />);
    await screen.findByText("Refund for duplicate charge");

    expect(get).toHaveBeenLastCalledWith(
      "/api/tickets",
      expect.objectContaining({
        params: expect.objectContaining({ page: 1, pageSize: 10 }),
      }),
    );
  });

  it("disables Prev on the first page and Next when there's a single page", async () => {
    // total (2) <= pageSize (20) → one page, so both controls are disabled.
    mockGet().mockResolvedValue({
      data: { tickets: sampleTickets, total: sampleTickets.length },
    });

    renderWithClient(<TicketsPage />);
    await screen.findByText("Refund for duplicate charge");

    expect(
      screen.getByRole("button", { name: /previous page/i }),
    ).toBeDisabled();
    expect(screen.getByRole("button", { name: /next page/i })).toBeDisabled();
  });

  it("fetches the next page when Next is clicked", async () => {
    // total 50 with pageSize 20 → 3 pages, so Next is enabled.
    const get = mockGet().mockResolvedValue({
      data: { tickets: sampleTickets, total: 50 },
    });
    const user = userEvent.setup();

    renderWithClient(<TicketsPage />);
    await screen.findByText("Refund for duplicate charge");

    const next = screen.getByRole("button", { name: /next page/i });
    expect(next).toBeEnabled();
    await user.click(next);

    await waitFor(() =>
      expect(get).toHaveBeenLastCalledWith(
        "/api/tickets",
        expect.objectContaining({
          params: expect.objectContaining({ page: 2 }),
        }),
      ),
    );
  });

  it("resets to the first page when the sort changes", async () => {
    const get = mockGet().mockResolvedValue({
      data: { tickets: sampleTickets, total: 50 },
    });
    const user = userEvent.setup();

    renderWithClient(<TicketsPage />);
    await screen.findByText("Refund for duplicate charge");

    // Advance to page 2.
    await user.click(screen.getByRole("button", { name: /next page/i }));
    await waitFor(() =>
      expect(get).toHaveBeenLastCalledWith(
        "/api/tickets",
        expect.objectContaining({
          params: expect.objectContaining({ page: 2 }),
        }),
      ),
    );

    // Changing the sort snaps back to page 1.
    await user.click(screen.getByRole("button", { name: /sort by subject/i }));
    await waitFor(() =>
      expect(get).toHaveBeenLastCalledWith(
        "/api/tickets",
        expect.objectContaining({
          params: expect.objectContaining({ page: 1, sort: "subject" }),
        }),
      ),
    );
  });
});
