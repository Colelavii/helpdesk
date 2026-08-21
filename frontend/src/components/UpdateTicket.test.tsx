import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axios from "axios";
import {
  TicketStatus,
  TicketCategory,
  type TicketWithThread,
} from "@helpdesk/core";
import UpdateTicket from "./UpdateTicket";
import { renderWithClient } from "../test/render";

type GetMock = Mock<(url: string, config?: unknown) => Promise<unknown>>;

function mockGet(): GetMock {
  const get = vi.spyOn(axios, "get") as unknown as GetMock;
  get.mockResolvedValue({ data: { users: [] } });
  return get;
}

const ticket: TicketWithThread = {
  id: 7,
  subject: "Cannot access the portal",
  requesterEmail: "sam@example.com",
  requesterName: "Sam Student",
  status: TicketStatus.open,
  category: TicketCategory.technical,
  createdAt: "2024-03-20T10:00:00.000Z",
  updatedAt: "2024-03-20T10:00:00.000Z",
  assignedTo: null,
  messages: [],
  aiResolvedAt: null,
  aiConfidence: null,
  aiDecision: null,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("UpdateTicket", () => {
  // `new` and `processing` belong to the auto-resolve worker. Offering either
  // would hand the agent a status the PATCH route rejects, and picking one
  // would drop the ticket out of the list with nothing left to bring it back.
  it("offers only the statuses an agent owns", async () => {
    mockGet();
    const user = userEvent.setup();
    renderWithClient(<UpdateTicket ticket={ticket} />);

    await user.click(screen.getByRole("combobox", { name: /ticket status/i }));

    const listbox = await screen.findByRole("listbox");
    const options = within(listbox)
      .getAllByRole("option")
      .map((option) => option.textContent);

    expect(options).toEqual([
      TicketStatus.open,
      TicketStatus.resolved,
      TicketStatus.closed,
    ]);
  });

  // A ticket can be sitting at `processing` when an agent opens it by direct
  // URL. Radix renders the matching item's label on the trigger, so dropping
  // the status from the list entirely leaves the control blank.
  describe("a ticket the worker still owns", () => {
    function renderProcessing() {
      mockGet();
      renderWithClient(
        <UpdateTicket ticket={{ ...ticket, status: TicketStatus.processing }} />,
      );
    }

    it("shows the worker-owned status on the trigger", () => {
      renderProcessing();

      expect(
        screen.getByRole("combobox", { name: /ticket status/i }),
      ).toHaveTextContent(TicketStatus.processing);
    });

    it("lists it, but not as something the agent can pick", async () => {
      const user = userEvent.setup();
      renderProcessing();

      await user.click(screen.getByRole("combobox", { name: /ticket status/i }));
      const listbox = await screen.findByRole("listbox");

      expect(
        within(listbox).getByRole("option", { name: TicketStatus.processing }),
      ).toHaveAttribute("aria-disabled", "true");
      expect(
        within(listbox).getByRole("option", { name: TicketStatus.open }),
      ).not.toHaveAttribute("aria-disabled", "true");
    });
  });

  // Exactly the same problem as the status picker, and now the normal case: the
  // AI agent owns every ticket in the auto-resolve window but is deliberately
  // absent from /assignees, since it must not be assignable by hand.
  describe("an assignee missing from the picker's list", () => {
    const assignedToAi = {
      ...ticket,
      assignedTo: { id: "ai-1", name: "AI", email: "ai@helpdesk.local" },
    };

    function renderAssignedToAi() {
      // The AI is not in the fetched list.
      mockGet().mockResolvedValue({
        data: {
          users: [
            { id: "u-2", name: "Glen Agent", email: "glen@example.com" },
          ],
        },
      });
      renderWithClient(<UpdateTicket ticket={assignedToAi} />);
    }

    // Without this the trigger falls back to its "Unassigned" placeholder — it
    // would claim nobody owns a ticket the AI is actively working on.
    it("names the assignee on the trigger rather than showing Unassigned", async () => {
      renderAssignedToAi();

      const trigger = await screen.findByRole("combobox", {
        name: /assign ticket/i,
      });
      expect(trigger).toHaveTextContent("AI");
      expect(trigger).not.toHaveTextContent("Unassigned");
    });

    it("lists it, but not as something the agent can pick", async () => {
      const user = userEvent.setup();
      renderAssignedToAi();

      await user.click(
        await screen.findByRole("combobox", { name: /assign ticket/i }),
      );
      const listbox = await screen.findByRole("listbox");

      expect(
        within(listbox).getByRole("option", { name: "AI" }),
      ).toHaveAttribute("aria-disabled", "true");
      expect(
        within(listbox).getByRole("option", { name: "Glen Agent" }),
      ).not.toHaveAttribute("aria-disabled", "true");
      // Unassigning is still allowed — that's how an agent takes it off the AI.
      expect(
        within(listbox).getByRole("option", { name: "Unassigned" }),
      ).not.toHaveAttribute("aria-disabled", "true");
    });
  });
});
