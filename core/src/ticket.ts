// Ticket enums. String values match the Prisma `TicketStatus` / `TicketCategory`
// enums and the values stored in the database / returned by the API — prefer the
// enum over the raw strings in both client and server code.
export enum TicketStatus {
  open = "open",
  resolved = "resolved",
  closed = "closed",
}

export enum TicketCategory {
  general = "general",
  technical = "technical",
  refund = "refund",
}
