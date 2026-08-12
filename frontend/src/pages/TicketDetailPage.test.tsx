import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import axios from "axios";
import {
  TicketStatus,
  TicketCategory,
  type TicketAssignee,
  type TicketWithThread,
} from "@helpdesk/core";
import TicketDetailPage from "./TicketDetailPage";
import { renderWithClient } from "../test/render";

type GetMock = Mock<(url: string, config?: unknown) => Promise<unknown>>;

function mockGet(): GetMock {
  return vi.spyOn(axios, "get") as unknown as GetMock;
}

type PostMock = Mock<(url: string, body?: unknown) => Promise<unknown>>;

function mockPost(): PostMock {
  return vi.spyOn(axios, "post") as unknown as PostMock;
}

const sampleTicket: TicketWithThread = {
  id: 7,
  subject: "Cannot access the portal",
  requesterEmail: "sam@example.com",
  requesterName: "Sam Student",
  status: TicketStatus.open,
  category: TicketCategory.technical,
  assignedTo: { id: "u1", name: "Agent Smith", email: "smith@helpdesk.test" },
  createdAt: "2024-03-20T10:00:00.000Z",
  updatedAt: "2024-03-20T10:00:00.000Z",
  messages: [
    {
      id: 1,
      direction: "inbound",
      fromEmail: "sam@example.com",
      fromName: "Sam Student",
      body: "I keep getting an error when logging in.",
      createdAt: "2024-03-20T10:00:00.000Z",
    },
    {
      id: 2,
      direction: "outbound",
      fromEmail: "agent@helpdesk.test",
      fromName: "Support Agent",
      body: "Have you tried resetting your password?",
      createdAt: "2024-03-20T11:00:00.000Z",
    },
  ],
};

const sampleAssignees: TicketAssignee[] = [
  { id: "u1", name: "Agent Smith", email: "smith@helpdesk.test" },
  { id: "u2", name: "Dana Agent", email: "dana@helpdesk.test" },
];

// The detail page fetches both the ticket and the assignee list; route each GET
// to the right payload.
function mockDetailGet(ticket = sampleTicket, assignees = sampleAssignees) {
  return mockGet().mockImplementation((url: string) =>
    url.includes("/assignees")
      ? Promise.resolve({ data: { users: assignees } })
      : Promise.resolve({ data: { ticket } }),
  );
}

// Render the detail page at /tickets/:id so useParams resolves the id.
function renderDetail(id = "7") {
  return renderWithClient(
    <Routes>
      <Route path="/tickets/:id" element={<TicketDetailPage />} />
    </Routes>,
    { route: `/tickets/${id}` },
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TicketDetailPage", () => {
  it("requests the ticket by id from the route param", async () => {
    const get = mockDetailGet();

    renderDetail("7");
    await screen.findByRole("heading", { name: "Cannot access the portal" });

    expect(get).toHaveBeenCalledWith(
      "/api/tickets/7",
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it("shows a loading skeleton while the request is in flight", () => {
    mockGet().mockReturnValue(new Promise(() => {}));

    const { container } = renderDetail();

    expect(
      container.querySelectorAll('[data-slot="skeleton"]').length,
    ).toBeGreaterThan(0);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders the ticket header and the message thread in order", async () => {
    mockDetailGet();

    renderDetail();

    expect(
      await screen.findByRole("heading", { name: "Cannot access the portal" }),
    ).toBeInTheDocument();
    // The requester appears in the header and again as the inbound sender.
    expect(screen.getAllByText(/Sam Student/).length).toBeGreaterThan(0);

    // Status, category, and assignee are editable Selects. Radix Select's
    // selected value / options aren't reliably assertable in jsdom, so we check
    // the controls exist; the update interactions are covered by e2e.
    expect(screen.getByText("Status")).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: /ticket status/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Category")).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: /ticket category/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Assigned to")).toBeInTheDocument();
    expect(
      screen.getByRole("combobox", { name: /assign ticket/i }),
    ).toBeInTheDocument();

    // Both messages render, oldest first.
    const inbound = screen.getByText(
      "I keep getting an error when logging in.",
    );
    const outbound = screen.getByText(
      "Have you tried resetting your password?",
    );
    expect(inbound).toBeInTheDocument();
    expect(outbound).toBeInTheDocument();
    expect(
      inbound.compareDocumentPosition(outbound) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("fetches the assignee list for the assign control", async () => {
    const get = mockDetailGet();

    renderDetail();
    await screen.findByRole("heading", { name: "Cannot access the portal" });

    expect(get).toHaveBeenCalledWith(
      "/api/tickets/assignees",
      expect.objectContaining({ signal: expect.anything() }),
    );
    expect(
      screen.getByRole("combobox", { name: /assign ticket/i }),
    ).toBeInTheDocument();
  });

  it("shows a not-found message on a 404", async () => {
    mockGet().mockRejectedValue({
      isAxiosError: true,
      response: { status: 404, data: { error: "Ticket not found" } },
    });

    renderDetail("999");

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("This ticket could not be found.");
  });

  it("shows a generic error message on other failures", async () => {
    mockGet().mockRejectedValue(new Error("network down"));

    renderDetail();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Unable to load this ticket.");
  });

  it("posts a reply and re-fetches the thread", async () => {
    const get = mockDetailGet();
    const post = mockPost().mockResolvedValue({
      data: {
        message: {
          id: 3,
          direction: "outbound",
          fromEmail: "agent@helpdesk.test",
          fromName: "Support Agent",
          body: "Here's how to fix it.",
          createdAt: "2024-03-20T12:00:00.000Z",
        },
      },
    });

    const user = userEvent.setup();
    renderDetail("7");
    await screen.findByRole("heading", { name: "Cannot access the portal" });

    await user.type(
      screen.getByRole("textbox", { name: /reply message/i }),
      "Here's how to fix it.",
    );
    await user.click(screen.getByRole("button", { name: /send reply/i }));

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith("/api/tickets/7/messages", {
        body: "Here's how to fix it.",
      }),
    );
    // A successful reply invalidates the ticket query, so it re-fetches.
    await waitFor(() =>
      expect(
        get.mock.calls.filter(([url]) => url === "/api/tickets/7").length,
      ).toBeGreaterThan(1),
    );
  });

  it("blocks an empty reply and does not call the API", async () => {
    mockDetailGet();
    const post = mockPost();

    const user = userEvent.setup();
    renderDetail("7");
    await screen.findByRole("heading", { name: "Cannot access the portal" });

    await user.click(screen.getByRole("button", { name: /send reply/i }));

    expect(await screen.findByText(/reply can't be empty/i)).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });
});
