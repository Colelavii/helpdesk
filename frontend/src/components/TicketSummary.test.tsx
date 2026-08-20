import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axios from "axios";
import {
  TicketStatus,
  TicketCategory,
  type TicketWithThread,
} from "@helpdesk/core";
import TicketSummary from "./TicketSummary";
import { renderWithClient } from "../test/render";

// axios.post is overloaded; cast the spy to a loose signature so the mock
// helpers don't fight overload resolution (mirrors the other specs).
type PostMock = Mock<
  (url: string, data?: unknown, config?: unknown) => Promise<unknown>
>;

function mockPost(): PostMock {
  return vi.spyOn(axios, "post") as unknown as PostMock;
}

type User = ReturnType<typeof userEvent.setup>;

const TICKET_ID = 42;

const ticket: TicketWithThread = {
  id: TICKET_ID,
  subject: "Cannot access the portal",
  requesterEmail: "sam@example.com",
  requesterName: "Sam Student",
  status: TicketStatus.open,
  category: TicketCategory.technical,
  createdAt: "2024-03-20T10:00:00.000Z",
  updatedAt: "2024-03-20T10:00:00.000Z",
  assignedTo: null,
  messages: [
    {
      id: 1,
      direction: "inbound",
      fromEmail: "sam@example.com",
      fromName: "Sam Student",
      body: "I can't log in.",
      createdAt: "2024-03-20T10:00:00.000Z",
    },
  ],
  aiResolvedAt: null,
  aiConfidence: null,
  aiDecision: null,
};

function renderSummary(overrides: Partial<TicketWithThread> = {}): User {
  const user = userEvent.setup();
  renderWithClient(<TicketSummary ticket={{ ...ticket, ...overrides }} />);
  return user;
}

function summarizeButton(): HTMLElement {
  return screen.getByRole("button", { name: /summarize|regenerate/i });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("TicketSummary", () => {
  it("renders a prompt to summarize before anything is generated", () => {
    renderSummary();

    expect(screen.getByRole("heading", { name: "Summary" })).toBeInTheDocument();
    expect(summarizeButton()).toBeEnabled();
    expect(
      screen.getByText(/summarize this ticket and its conversation history/i),
    ).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("POSTs to the summary endpoint and renders the result", async () => {
    const post = mockPost().mockResolvedValue({
      data: { summary: "Sam is locked out of the portal." },
    });
    const user = renderSummary();

    await user.click(summarizeButton());

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(`/api/tickets/${TICKET_ID}/summary`),
    );
    expect(
      await screen.findByText("Sam is locked out of the portal."),
    ).toBeInTheDocument();
  });

  // The summary is never persisted or cached — every click regenerates it, so
  // it always reflects the thread as it currently stands.
  it("regenerates on every click rather than reusing the first summary", async () => {
    const post = mockPost()
      .mockResolvedValueOnce({ data: { summary: "First summary." } })
      .mockResolvedValueOnce({ data: { summary: "Second summary." } });
    const user = renderSummary();

    await user.click(summarizeButton());
    expect(await screen.findByText("First summary.")).toBeInTheDocument();

    await user.click(summarizeButton());
    expect(await screen.findByText("Second summary.")).toBeInTheDocument();

    expect(post).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("First summary.")).not.toBeInTheDocument();
  });

  it("offers to regenerate once a summary exists", async () => {
    mockPost().mockResolvedValue({ data: { summary: "A summary." } });
    const user = renderSummary();

    await user.click(summarizeButton());

    expect(
      await screen.findByRole("button", { name: /regenerate/i }),
    ).toBeInTheDocument();
  });

  it("disables the button while a summary is being generated", async () => {
    mockPost().mockReturnValue(new Promise(() => {}));
    const user = renderSummary();

    await user.click(summarizeButton());

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: /summarising/i }),
      ).toBeDisabled(),
    );
  });

  it("disables the button when the ticket has no messages", () => {
    const post = mockPost();
    renderSummary({ messages: [] });

    expect(summarizeButton()).toBeDisabled();
    expect(screen.getByText(/nothing to summarize yet/i)).toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it("surfaces the server's error message", async () => {
    mockPost().mockRejectedValue({
      isAxiosError: true,
      response: { data: { error: "Summarising is not configured." } },
    });
    const user = renderSummary();

    await user.click(summarizeButton());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Summarising is not configured.");
  });

  it("falls back to a generic message for non-axios failures", async () => {
    mockPost().mockRejectedValue(new Error("network exploded"));
    const user = renderSummary();

    await user.click(summarizeButton());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Unable to summarise this ticket. Please try again.",
    );
  });

  it("replaces a previous error once a retry succeeds", async () => {
    const post = mockPost().mockRejectedValueOnce(
      new Error("network exploded"),
    );
    const user = renderSummary();

    await user.click(summarizeButton());
    await screen.findByRole("alert");

    post.mockResolvedValue({ data: { summary: "Recovered summary." } });
    await user.click(summarizeButton());

    expect(await screen.findByText("Recovered summary.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
