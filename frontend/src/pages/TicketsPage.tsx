import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { SortingState } from "@tanstack/react-table";
import axios from "axios";
import type { TicketsQuery } from "@helpdesk/core";
import { useDebounce } from "@/hooks/use-debounce";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import TicketsTable, {
  type TicketRow,
  type TicketFilters,
} from "@/components/TicketsTable";

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
  const [filters, setFilters] = useState<TicketFilters>({});

  // Always keep a sort so the server has a deterministic order.
  const sort = (sorting[0]?.id ?? "createdAt") as TicketsQuery["sort"];
  const order: TicketsQuery["order"] = sorting[0]?.desc ? "desc" : "asc";

  // Debounce the search string so we only fire a server request 300 ms after
  // the user stops typing, keeping the input responsive.
  const debouncedSearch = useDebounce(filters.search, 300);

  const params: TicketsQuery = {
    sort,
    order,
    ...(filters.status && { status: filters.status }),
    ...(filters.category && { category: filters.category }),
    ...(debouncedSearch && { search: debouncedSearch }),
  };

  const {
    data: tickets,
    isPending,
    isError,
  } = useQuery({
    queryKey: ["tickets", params],
    queryFn: ({ signal }) => fetchTickets(params, signal),
    placeholderData: keepPreviousData,
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
            Search by subject or requester, filter by status or category, click
            a column to sort.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isPending ? (
            <TicketsTable
              isPending
              sorting={sorting}
              onSortingChange={setSorting}
              filters={filters}
              onFiltersChange={setFilters}
            />
          ) : isError ? (
            <p role="alert" className="text-sm text-destructive">
              Unable to load tickets.
            </p>
          ) : (
            <TicketsTable
              tickets={tickets}
              sorting={sorting}
              onSortingChange={setSorting}
              filters={filters}
              onFiltersChange={setFilters}
            />
          )}
        </CardContent>
      </Card>
    </section>
  );
}
