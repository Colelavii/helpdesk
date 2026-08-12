import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import {
  TicketStatus,
  TicketCategory,
  type TicketMessage,
  type TicketWithThread,
} from "@helpdesk/core";
import MessageThread from "./MessageThread";
import { renderWithClient } from "../test/render";

// Mirrors the component's own formatter so the assertion follows whatever locale
// the test runner uses instead of hardcoding one.
const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const inbound: TicketMessage = {
  id: 1,
  direction: "inbound",
  fromEmail: "sam@example.com",
  fromName: "Sam Student",
  body: "I keep getting an error when logging in.",
  createdAt: "2024-03-20T10:00:00.000Z",
};

const outbound: TicketMessage = {
  id: 2,
  direction: "outbound",
  fromEmail: "agent@helpdesk.test",
  fromName: "Support Agent",
  body: "Have you tried resetting your password?",
  createdAt: "2024-03-20T11:00:00.000Z",
};

function ticketWith(messages: TicketMessage[]): TicketWithThread {
  return {
    id: 7,
    subject: "Cannot access the portal",
    requesterEmail: "sam@example.com",
    requesterName: "Sam Student",
    status: TicketStatus.open,
    category: TicketCategory.technical,
    assignedTo: null,
    createdAt: "2024-03-20T10:00:00.000Z",
    updatedAt: "2024-03-20T11:00:00.000Z",
    messages,
  };
}

describe("MessageThread", () => {
  it("renders a Conversation heading", () => {
    renderWithClient(<MessageThread ticket={ticketWith([inbound])} />);

    expect(
      screen.getByRole("heading", { level: 2, name: "Conversation" }),
    ).toBeInTheDocument();
  });

  it("shows an empty state when the ticket has no messages", () => {
    renderWithClient(<MessageThread ticket={ticketWith([])} />);

    expect(
      screen.getByText("No messages on this ticket yet."),
    ).toBeInTheDocument();
    // The heading stays so the section doesn't disappear entirely.
    expect(
      screen.getByRole("heading", { level: 2, name: "Conversation" }),
    ).toBeInTheDocument();
    expect(screen.queryByText(inbound.direction)).not.toBeInTheDocument();
  });

  it("renders every message's sender, address, and body", () => {
    renderWithClient(<MessageThread ticket={ticketWith([inbound, outbound])} />);

    expect(screen.getByText("Sam Student")).toBeInTheDocument();
    expect(screen.getByText("<sam@example.com>")).toBeInTheDocument();
    expect(screen.getByText(inbound.body)).toBeInTheDocument();

    expect(screen.getByText("Support Agent")).toBeInTheDocument();
    expect(screen.getByText("<agent@helpdesk.test>")).toBeInTheDocument();
    expect(screen.getByText(outbound.body)).toBeInTheDocument();

    expect(
      screen.queryByText("No messages on this ticket yet."),
    ).not.toBeInTheDocument();
  });

  it("labels each message with its direction", () => {
    renderWithClient(<MessageThread ticket={ticketWith([inbound, outbound])} />);

    expect(screen.getByText("inbound")).toBeInTheDocument();
    expect(screen.getByText("outbound")).toBeInTheDocument();
  });

  it("timestamps each message", () => {
    renderWithClient(<MessageThread ticket={ticketWith([inbound, outbound])} />);

    expect(
      screen.getByText(dateTimeFormatter.format(new Date(inbound.createdAt))),
    ).toBeInTheDocument();
    expect(
      screen.getByText(dateTimeFormatter.format(new Date(outbound.createdAt))),
    ).toBeInTheDocument();
  });

  // The server sends the thread oldest-first; the component must not reorder it.
  it("renders messages in the order given", () => {
    renderWithClient(<MessageThread ticket={ticketWith([inbound, outbound])} />);

    const first = screen.getByText(inbound.body);
    const second = screen.getByText(outbound.body);

    expect(
      first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("preserves line breaks inside a message body", () => {
    const multiline: TicketMessage = {
      ...inbound,
      body: "First line.\nSecond line.",
    };

    renderWithClient(<MessageThread ticket={ticketWith([multiline])} />);

    // Queried on the whitespace-normalised text, then asserted on the raw
    // content — the body is rendered pre-wrap, so the newline must survive.
    expect(screen.getByText("First line. Second line.").textContent).toBe(
      multiline.body,
    );
  });
});
