import { z } from "zod";

// Shared by the tickets list endpoint (server-side validation of the sort query)
// and the tickets table (TanStack column ids + default sort). Sorting runs on the
// server, so this whitelist is what the client may ask the DB to order by.
export const ticketSortFields = [
  "subject",
  "requesterName",
  "status",
  "category",
  "createdAt",
] as const;

export const ticketsQuerySchema = z.object({
  sort: z.enum(ticketSortFields).default("createdAt"),
  order: z.enum(["asc", "desc"]).default("desc"),
});

export type TicketSortField = (typeof ticketSortFields)[number];
export type TicketsQuery = z.infer<typeof ticketsQuerySchema>;
