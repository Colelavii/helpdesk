import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { OnChangeFn, PaginationState, SortingState } from "@tanstack/react-table";
import axios from "axios";
import type { Ticket, TicketsQuery } from "@helpdesk/core";
import { useDebounce } from "@/hooks/use-debounce";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import TicketsTable, { type TicketFilters } from "@/components/TicketsTable";
import ErrorMessage from "@/components/ErrorMessage";

interface TicketsResponse {
  tickets: Ticket[];
  total: number;
}

async function fetchTickets(
  params: TicketsQuery,
  signal: AbortSignal,
): Promise<TicketsResponse> {
  const { data } = await axios.get<TicketsResponse>("/api/tickets", {
    params,
    signal,
  });
  return data;
}

export default function TicketsPage() {
  const [sorting, setSorting] = useState<SortingState>([
    { id: "createdAt", desc: true },
  ]);
  const [filters, setFilters] = useState<TicketFilters>({});
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 10,
  });

  // Changing the sort, a filter, or the search resets back to the first page —
  // otherwise you could be stranded on a page that no longer exists.
  const handleSortingChange: OnChangeFn<SortingState> = (updater) => {
    setSorting(updater);
    setPagination((p) => ({ ...p, pageIndex: 0 }));
  };
  const handleFiltersChange = (next: TicketFilters) => {
    setFilters(next);
    setPagination((p) => ({ ...p, pageIndex: 0 }));
  };

  // Always keep a sort so the server has a deterministic order.
  const sort = (sorting[0]?.id ?? "createdAt") as TicketsQuery["sort"];
  const order: TicketsQuery["order"] = sorting[0]?.desc ? "desc" : "asc";

  // Debounce the search string so we only fire a server request 300 ms after
  // the user stops typing, keeping the input responsive.
  const debouncedSearch = useDebounce(filters.search, 300);

  const params: TicketsQuery = {
    sort,
    order,
    page: pagination.pageIndex + 1,
    pageSize: pagination.pageSize,
    ...(filters.status && { status: filters.status }),
    ...(filters.category && { category: filters.category }),
    ...(debouncedSearch && { search: debouncedSearch }),
  };

  const { data, isPending, isError } = useQuery({
    queryKey: ["tickets", params],
    queryFn: ({ signal }) => fetchTickets(params, signal),
    placeholderData: keepPreviousData,
  });

  const total = data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / pagination.pageSize));

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
              onSortingChange={handleSortingChange}
              filters={filters}
              onFiltersChange={handleFiltersChange}
              pagination={pagination}
              onPaginationChange={setPagination}
              pageCount={pageCount}
              total={total}
            />
          ) : isError ? (
            <ErrorMessage>Unable to load tickets.</ErrorMessage>
          ) : (
            <TicketsTable
              tickets={data.tickets}
              sorting={sorting}
              onSortingChange={handleSortingChange}
              filters={filters}
              onFiltersChange={handleFiltersChange}
              pagination={pagination}
              onPaginationChange={setPagination}
              pageCount={pageCount}
              total={total}
            />
          )}
        </CardContent>
      </Card>
    </section>
  );
}
