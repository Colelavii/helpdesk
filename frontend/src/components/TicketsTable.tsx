import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import type { TicketStatus, TicketCategory } from "@helpdesk/core";

export interface TicketRow {
  id: number;
  subject: string;
  requesterEmail: string;
  requesterName: string;
  status: TicketStatus;
  category: TicketCategory | null;
  createdAt: string;
}

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
});

const SKELETON_ROWS = 5;

export default function TicketsTable({
  tickets,
  isPending = false,
}: {
  tickets?: TicketRow[];
  isPending?: boolean;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Subject</TableHead>
          <TableHead>Requester</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Category</TableHead>
          <TableHead>Received</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {isPending
          ? Array.from({ length: SKELETON_ROWS }).map((_, i) => (
              <TableRow key={i}>
                <TableCell>
                  <Skeleton className="h-4 w-48" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-40" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-16" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-20" />
                </TableCell>
                <TableCell>
                  <Skeleton className="h-4 w-24" />
                </TableCell>
              </TableRow>
            ))
          : tickets?.map((ticket) => (
              <TableRow key={ticket.id}>
                <TableCell className="font-medium">{ticket.subject}</TableCell>
                <TableCell className="text-muted-foreground">
                  {ticket.requesterName}{" "}
                  <span className="text-xs">&lt;{ticket.requesterEmail}&gt;</span>
                </TableCell>
                <TableCell className="capitalize">{ticket.status}</TableCell>
                <TableCell className="capitalize text-muted-foreground">
                  {ticket.category ?? "—"}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {dateFormatter.format(new Date(ticket.createdAt))}
                </TableCell>
              </TableRow>
            ))}
      </TableBody>
    </Table>
  );
}
