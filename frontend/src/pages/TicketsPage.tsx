import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import TicketsTable, { type TicketRow } from "@/components/TicketsTable";

async function fetchTickets(signal: AbortSignal): Promise<TicketRow[]> {
  const { data } = await axios.get<{ tickets: TicketRow[] }>("/api/tickets", {
    signal,
  });
  return data.tickets;
}

export default function TicketsPage() {
  const {
    data: tickets,
    isPending,
    isError,
  } = useQuery({
    queryKey: ["tickets"],
    queryFn: ({ signal }) => fetchTickets(signal),
  });

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Tickets</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Student support requests assigned to your team.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Support requests</CardTitle>
          <CardDescription>
            Incoming tickets, newest first.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isPending ? (
            <TicketsTable isPending />
          ) : isError ? (
            <p role="alert" className="text-sm text-destructive">
              Unable to load tickets.
            </p>
          ) : tickets.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tickets yet.</p>
          ) : (
            <TicketsTable tickets={tickets} />
          )}
        </CardContent>
      </Card>
    </section>
  );
}
