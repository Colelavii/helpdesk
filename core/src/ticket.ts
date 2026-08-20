// Ticket enums. String values match the Prisma `TicketStatus` / `TicketCategory`
// enums and the values stored in the database / returned by the API — prefer the
// enum over the raw strings in both client and server code.
export enum TicketStatus {
  // The AI auto-resolve window. A ticket arrives as `new`, the worker claims it
  // as `processing`, and it leaves as `resolved` or `open`. Neither appears in
  // the default ticket list, and neither can be set through the API.
  new = "new",
  processing = "processing",
  open = "open",
  resolved = "resolved",
  closed = "closed",
}

// The statuses an agent may set by hand. `new` and `processing` are owned by
// the auto-resolve worker — the PATCH route and the detail page's status picker
// both work off this list.
export const agentTicketStatuses = [
  TicketStatus.open,
  TicketStatus.resolved,
  TicketStatus.closed,
] as const;

export enum TicketCategory {
  general = "general",
  technical = "technical",
  refund = "refund",
}

// The ticket as the API returns it — the fields the list and detail endpoints
// both carry. Timestamps are ISO strings because these describe the JSON
// payload, not the Prisma rows (where they're `Date`s).
export interface Ticket {
  id: number;
  subject: string;
  requesterEmail: string;
  requesterName: string;
  status: TicketStatus;
  category: TicketCategory | null;
  createdAt: string;
  updatedAt: string;
}

// The staff member a ticket is assigned to, as embedded in a ticket payload.
export interface TicketAssignee {
  id: string;
  name: string;
  email: string;
}

// One message in a ticket's conversation. `direction` is inbound for student
// mail and outbound for agent replies.
export interface TicketMessage {
  id: number;
  direction: "inbound" | "outbound";
  fromEmail: string;
  fromName: string;
  body: string;
  createdAt: string;
}

// What the detail endpoint returns: a ticket plus its assignee, thread, and the
// auto-resolve worker's decision. The AI fields are detail-only — the list keeps
// its select lean. `aiResolvedAt` is non-null only when the model answered the
// ticket itself; `aiConfidence`/`aiDecision` are recorded on escalations too.
export interface TicketWithThread extends Ticket {
  assignedTo: TicketAssignee | null;
  messages: TicketMessage[];
  aiResolvedAt: string | null;
  aiConfidence: number | null;
  aiDecision: string | null;
}
