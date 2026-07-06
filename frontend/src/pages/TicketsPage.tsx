import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { SortingState } from "@tanstack/react-table";
import axios from "axios";
import type { TicketsQuery } from "@helpdesk/core";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import TicketsTable, { type TicketRow } from "@/components/TicketsTable";

async function fetchTickets(
  params: TicketsQuery,
  signal: AbortSignal,
): Promise<TicketRow[]> {
  const { data } = await axios.get<{ tickets: TicketRow[] }>("/api/tickets", {
    params,
    signal,
  });
  return data.tickets;
}

export default function TicketsPage() {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "createdAt", desc: true },
  ]);

  // Always keep a sort so the server has a deterministic order.
  const sort = (sorting[0]?.id ?? "createdAt") as TicketsQuery["sort"];
  const order: TicketsQuery["order"] = sorting[0]?.desc ? "desc" : "asc";

  const {
    data: tickets,
    isPending,
    isError,
  } = useQuery({
    queryKey: ["tickets", { sort, order }],
    queryFn: ({ signal }) => fetchTickets({ sort, order }, signal),
    placeholderData: keepPreviousData, // don't flash the skeleton on re-sort
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
            Incoming tickets — click a column to sort.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isPending ? (
            <TicketsTable
              isPending
              sorting={sorting}
              onSortingChange={setSorting}
            />
          ) : isError ? (
            <p role="alert" className="text-sm text-destructive">
              Unable to load tickets.
            </p>
          ) : tickets.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tickets yet.</p>
          ) : (
            <TicketsTable
              tickets={tickets}
              sorting={sorting}
              onSortingChange={setSorting}
            />
          )}
        </CardContent>
      </Card>
    </section>
  );
}
