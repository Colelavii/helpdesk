import { z } from "zod";
import { TicketStatus, TicketCategory } from "../ticket.ts";

// Shared by the tickets list endpoint (server-side validation of the sort/filter
// query) and the tickets table (TanStack column ids + default sort). All
// filtering and sorting run on the server.
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
  // Optional filters — omitting a param returns all values for that field.
  // Reuse the canonical TicketStatus / TicketCategory enums as the value source.
  status: z.enum(TicketStatus).optional(),
  category: z.enum(TicketCategory).optional(),
  // Free-text search across subject, requester name, and requester email.
  // Empty string is treated the same as omitting the param.
  search: z.string().trim().optional(),
  // Pagination (1-based page). Coerced because query params arrive as strings.
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
});

export type TicketSortField = (typeof ticketSortFields)[number];
export type TicketsQuery = z.infer<typeof ticketsQuerySchema>;
