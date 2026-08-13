import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient } from "@tanstack/react-query";
import axios from "axios";
import { TicketStatus, TicketCategory, type Ticket } from "@helpdesk/core";
import ReplyForm from "./ReplyForm";
import { renderWithClient } from "../test/render";

// axios.post is overloaded; cast the spy to a loose signature so the mock
// helpers don't fight overload resolution (mirrors the dialog specs).
type PostMock = Mock<
  (url: string, data?: unknown, config?: unknown) => Promise<unknown>
>;

function mockPost(): PostMock {
  return vi.spyOn(axios, "post") as unknown as PostMock;
}

type User = ReturnType<typeof userEvent.setup>;

const TICKET_ID = 42;

const ticket: Ticket = {
  id: TICKET_ID,
  subject: "Cannot access the portal",
  requesterEmail: "sam@example.com",
  requesterName: "Sam Student",
  status: TicketStatus.open,
  category: TicketCategory.technical,
  createdAt: "2024-03-20T10:00:00.000Z",
  updatedAt: "2024-03-20T10:00:00.000Z",
};

function renderReplyForm(): User {
  const user = userEvent.setup();
  renderWithClient(<ReplyForm ticket={ticket} />);
  return user;
}

function replyBox(): HTMLElement {
  return screen.getByRole("textbox", { name: /reply message/i });
}

function sendButton(): HTMLElement {
  return screen.getByRole("button", { name: /send reply/i });
}

function polishButton(): HTMLElement {
  return screen.getByRole("button", { name: /^polish/i });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("ReplyForm", () => {
  it("renders an empty reply box with send disabled", () => {
    renderReplyForm();

    expect(screen.getByRole("heading", { name: "Reply" })).toBeInTheDocument();
    expect(replyBox()).toHaveValue("");
    expect(sendButton()).toBeDisabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("POSTs the reply to the ticket's messages endpoint", async () => {
    const post = mockPost().mockResolvedValue({ data: {} });
    const user = renderReplyForm();

    await user.type(replyBox(), "Here's how to fix it.");
    await user.click(sendButton());

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(`/api/tickets/${TICKET_ID}/messages`, {
        body: "Here's how to fix it.",
      }),
    );
  });

  it("clears the reply box after a successful send", async () => {
    mockPost().mockResolvedValue({ data: {} });
    const user = renderReplyForm();

    await user.type(replyBox(), "On its way.");
    await user.click(sendButton());

    await waitFor(() => expect(replyBox()).toHaveValue(""));
  });

  // The detail page keys that query by the route param, so the id must be
  // stringified here or the thread would never re-fetch.
  it("invalidates the ticket query so the thread re-fetches", async () => {
    const invalidate = vi.spyOn(QueryClient.prototype, "invalidateQueries");
    mockPost().mockResolvedValue({ data: {} });
    const user = renderReplyForm();

    await user.type(replyBox(), "Replying now.");
    await user.click(sendButton());

    await waitFor(() =>
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: ["ticket", String(TICKET_ID)],
      }),
    );
  });

  it("sends the trimmed body (the shared schema trims)", async () => {
    const post = mockPost().mockResolvedValue({ data: {} });
    const user = renderReplyForm();

    await user.type(replyBox(), "   Padded reply.   ");
    await user.click(sendButton());

    await waitFor(() =>
      expect(post).toHaveBeenCalledWith(`/api/tickets/${TICKET_ID}/messages`, {
        body: "Padded reply.",
      }),
    );
  });

  // An empty draft is blocked by disabling send, not by a validation message —
  // so there is nothing to click and no error copy to assert.
  it("enables send once the draft has content, and disables it again when cleared", async () => {
    const user = renderReplyForm();

    expect(sendButton()).toBeDisabled();

    await user.type(replyBox(), "Here's how to fix it.");
    expect(sendButton()).toBeEnabled();

    await user.clear(replyBox());
    expect(sendButton()).toBeDisabled();
  });

  it("keeps send disabled for a whitespace-only reply", async () => {
    const post = mockPost();
    const user = renderReplyForm();

    await user.type(replyBox(), "    ");

    expect(sendButton()).toBeDisabled();
    expect(screen.queryByText(/reply can't be empty/i)).not.toBeInTheDocument();
    expect(post).not.toHaveBeenCalled();
  });

  it("surfaces the server's error message and keeps the draft", async () => {
    mockPost().mockRejectedValue({
      isAxiosError: true,
      response: { data: { error: "This ticket is closed" } },
    });
    const user = renderReplyForm();

    await user.type(replyBox(), "Still typing here.");
    await user.click(sendButton());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("This ticket is closed");
    // The draft survives a failure so the agent can retry without retyping.
    expect(replyBox()).toHaveValue("Still typing here.");
  });

  it("falls back to a generic message for non-axios failures", async () => {
    mockPost().mockRejectedValue(new Error("network exploded"));
    const user = renderReplyForm();

    await user.type(replyBox(), "Anyone there?");
    await user.click(sendButton());

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(
      "Unable to send your reply. Please try again.",
    );
  });

  describe("polish", () => {
    it("stays disabled until the draft has content", async () => {
      const user = renderReplyForm();

      expect(polishButton()).toBeDisabled();

      await user.type(replyBox(), "cant login pls help");

      expect(polishButton()).toBeEnabled();
    });

    it("POSTs the draft to the polish endpoint and replaces it with the result", async () => {
      const post = mockPost().mockResolvedValue({
        data: { body: "Thanks for getting in touch. Let's get you back in." },
      });
      const user = renderReplyForm();

      await user.type(replyBox(), "cant login pls help");
      await user.click(polishButton());

      await waitFor(() =>
        expect(post).toHaveBeenCalledWith(`/api/tickets/${TICKET_ID}/polish`, {
          body: "cant login pls help",
        }),
      );
      await waitFor(() =>
        expect(replyBox()).toHaveValue(
          "Thanks for getting in touch. Let's get you back in.",
        ),
      );
    });

    it("does not send the reply", async () => {
      const post = mockPost().mockResolvedValue({ data: { body: "Polished." } });
      const user = renderReplyForm();

      await user.type(replyBox(), "rough draft");
      await user.click(polishButton());

      await waitFor(() => expect(replyBox()).toHaveValue("Polished."));
      expect(post).toHaveBeenCalledTimes(1);
      expect(post).not.toHaveBeenCalledWith(
        `/api/tickets/${TICKET_ID}/messages`,
        expect.anything(),
      );
    });

    it("surfaces the server's error message and keeps the draft", async () => {
      mockPost().mockRejectedValue({
        isAxiosError: true,
        response: { data: { error: "Polishing is not configured." } },
      });
      const user = renderReplyForm();

      await user.type(replyBox(), "my untouched draft");
      await user.click(polishButton());

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent("Polishing is not configured.");
      expect(replyBox()).toHaveValue("my untouched draft");
    });

    it("falls back to a generic message for non-axios failures", async () => {
      mockPost().mockRejectedValue(new Error("network exploded"));
      const user = renderReplyForm();

      await user.type(replyBox(), "another draft");
      await user.click(polishButton());

      const alert = await screen.findByRole("alert");
      expect(alert).toHaveTextContent(
        "Unable to polish your reply. Please try again.",
      );
    });
  });

  it("clears a previous error once a retry succeeds", async () => {
    const post = mockPost().mockRejectedValueOnce(
      new Error("network exploded"),
    );
    const user = renderReplyForm();

    await user.type(replyBox(), "First attempt.");
    await user.click(sendButton());
    await screen.findByRole("alert");

    post.mockResolvedValue({ data: {} });
    await user.click(sendButton());

    await waitFor(() =>
      expect(screen.queryByRole("alert")).not.toBeInTheDocument(),
    );
  });
});
