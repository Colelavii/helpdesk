import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import {
  TicketStatus,
  TicketCategory,
  type TicketWithThread,
} from "@helpdesk/core";
import TicketDetail from "./TicketDetail";
import { renderWithClient } from "../test/render";

// Mirrors the component's own formatter so the assertion follows whatever locale
// the test runner uses instead of hardcoding one.
const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const ticket: TicketWithThread = {
  id: 7,
  subject: "Cannot access the portal",
  requesterEmail: "sam@example.com",
  requesterName: "Sam Student",
  status: TicketStatus.open,
  category: TicketCategory.technical,
  createdAt: "2024-03-20T10:00:00.000Z",
  updatedAt: "2024-03-21T09:30:00.000Z",
  assignedTo: null,
  messages: [],
  aiResolvedAt: null,
  aiConfidence: null,
  aiDecision: null,
};

describe("TicketDetail", () => {
  it("renders the subject as the top-level heading", () => {
    renderWithClient(<TicketDetail ticket={ticket} />);

    expect(
      screen.getByRole("heading", { level: 1, name: "Cannot access the portal" }),
    ).toBeInTheDocument();
  });

  it("renders the requester's name and a mailto link to their address", () => {
    renderWithClient(<TicketDetail ticket={ticket} />);

    expect(screen.getByText("Sam Student")).toBeInTheDocument();

    const emailLink = screen.getByRole("link", { name: "sam@example.com" });
    expect(emailLink).toHaveAttribute("href", "mailto:sam@example.com");
  });

  it("shows when the ticket was opened, formatted for the locale", () => {
    renderWithClient(<TicketDetail ticket={ticket} />);

    expect(
      screen.getByText(dateTimeFormatter.format(new Date(ticket.createdAt))),
    ).toBeInTheDocument();
  });

  it("labels the requester and opened fields", () => {
    renderWithClient(<TicketDetail ticket={ticket} />);

    expect(screen.getByText("Requester")).toBeInTheDocument();
    expect(screen.getByText("Opened")).toBeInTheDocument();
  });

  // Status, category, and assignee are the editable side of a ticket and belong
  // to UpdateTicket — the header must not duplicate them.
  it("does not render the editable fields", () => {
    renderWithClient(<TicketDetail ticket={ticket} />);

    expect(screen.queryByText(TicketStatus.open)).not.toBeInTheDocument();
    expect(
      screen.queryByText(TicketCategory.technical),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText(dateTimeFormatter.format(new Date(ticket.updatedAt))),
    ).not.toBeInTheDocument();
  });

  // The auto-resolve worker's reply is an ordinary outbound message in the
  // thread, so without this note an agent would read it as a colleague's.
  describe("automatic resolution", () => {
    const aiResolvedAt = "2024-03-21T09:30:00.000Z";

    it("notes when the knowledge base answered the ticket, and when", () => {
      renderWithClient(<TicketDetail ticket={{ ...ticket, aiResolvedAt }} />);

      expect(
        screen.getByText(/answered automatically from the knowledge base/i),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          new RegExp(dateTimeFormatter.format(new Date(aiResolvedAt))),
        ),
      ).toBeInTheDocument();
    });

    it("says nothing on a ticket the AI did not resolve", () => {
      renderWithClient(<TicketDetail ticket={ticket} />);

      expect(
        screen.queryByText(/answered automatically/i),
      ).not.toBeInTheDocument();
    });

    // The note is about who wrote the reply, so it has to survive a student
    // replying and reopening the ticket — aiResolvedAt is kept, not cleared.
    it("stays on a reopened ticket", () => {
      renderWithClient(
        <TicketDetail
          ticket={{ ...ticket, aiResolvedAt, status: TicketStatus.open }}
        />,
      );

      expect(
        screen.getByText(/answered automatically from the knowledge base/i),
      ).toBeInTheDocument();
    });
  });
});
