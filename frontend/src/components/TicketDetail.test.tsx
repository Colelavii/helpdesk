import { describe, expect, it } from "vitest";
import { screen } from "@testing-library/react";
import { TicketStatus, TicketCategory, type Ticket } from "@helpdesk/core";
import TicketDetail from "./TicketDetail";
import { renderWithClient } from "../test/render";

// Mirrors the component's own formatter so the assertion follows whatever locale
// the test runner uses instead of hardcoding one.
const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

const ticket: Ticket = {
  id: 7,
  subject: "Cannot access the portal",
  requesterEmail: "sam@example.com",
  requesterName: "Sam Student",
  status: TicketStatus.open,
  category: TicketCategory.technical,
  createdAt: "2024-03-20T10:00:00.000Z",
  updatedAt: "2024-03-21T09:30:00.000Z",
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
});
