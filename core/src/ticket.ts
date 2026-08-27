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
  // Delivery state of an outbound reply, both null on inbound mail. `sentAt` is
  // set once Postmark has accepted the message; `deliveryError` carries the last
  // failure and is cleared by a later success. Neither set means it hasn't left:
  // still queued, sending not configured, or a reply predating outbound email.
  sentAt: string | null;
  deliveryError: string | null;
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

// The dashboard's headline figures, as the stats endpoint returns them.
//
// `total` counts every status, including the `new`/`processing` window the ticket
// list hides: that window is hidden because showing an agent a ticket the model
// may resolve a second later is unhelpful, which is not a reason to leave it out
// of a volume count.
//
// "Resolved by AI" means the model answered it *and the answer held*:
// `aiResolvedAt` is kept as audit data after a student's reply reopens a ticket,
// so counting it alone would headline tickets currently sitting in an agent's
// queue, and could push the count above the number of resolved tickets. The
// percentage is over `concluded` rather than `total` so it measures how well the
// model does on tickets that reached an outcome, not how big the backlog is —
// `concluded` travels with it so the UI can show the ratio it came from.
export interface TicketStats {
  total: number;
  open: number;
  concluded: number;
  aiResolved: number;
  // Null rather than 0 when there is nothing to divide by, so the UI can say
  // "no data yet" instead of claiming the AI resolved 0% of them.
  aiResolvedPercent: number | null;
  averageResolutionMinutes: number | null;
}

// One day's intake, for the dashboard's 30-day chart. `day` is a plain
// `YYYY-MM-DD` string in UTC rather than a timestamp: it's a bucket label, and
// sending it as a Date would let the browser's timezone shift a ticket into the
// neighbouring bar. Every day in the range is present, including quiet ones with
// a count of 0 — a missing bar would read as "no data" instead of "no tickets".
export interface TicketsPerDay {
  day: string;
  count: number;
}
