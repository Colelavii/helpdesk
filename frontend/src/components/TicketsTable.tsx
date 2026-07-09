import {
  type ColumnDef,
  type OnChangeFn,
  type PaginationState,
  type SortingState,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import {
  ArrowDown,
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  ChevronsUpDown,
  Search,
  X,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
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

export interface TicketFilters {
  status?: TicketStatus;
  category?: TicketCategory;
  search?: string;
}

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
});

const SKELETON_ROWS = 5;

// Status badge styling — distinct semantic colour per state.
const statusVariant: Record<
  TicketStatus,
  React.ComponentProps<typeof Badge>["variant"]
> = {
  open: "default",
  resolved: "secondary",
  closed: "outline",
};

// Column ids match `ticketSortFields` in @helpdesk/core so a header's id is
// exactly the `sort` param the server orders by.
const columns: ColumnDef<TicketRow>[] = [
  {
    id: "subject",
    accessorKey: "subject",
    header: "Subject",
    cell: ({ row }) => (
      <span className="font-medium">{row.original.subject}</span>
    ),
  },
  {
    id: "requesterName",
    header: "Requester",
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {row.original.requesterName}{" "}
        <span className="text-xs">&lt;{row.original.requesterEmail}&gt;</span>
      </span>
    ),
  },
  {
    id: "status",
    accessorKey: "status",
    header: "Status",
    cell: ({ row }) => (
      <Badge variant={statusVariant[row.original.status]}>
        {row.original.status}
      </Badge>
    ),
  },
  {
    id: "category",
    accessorKey: "category",
    header: "Category",
    cell: ({ row }) => (
      <span className="capitalize text-muted-foreground">
        {row.original.category ?? "—"}
      </span>
    ),
  },
  {
    id: "createdAt",
    accessorKey: "createdAt",
    header: "Received",
    cell: ({ row }) => (
      <span className="text-muted-foreground">
        {dateFormatter.format(new Date(row.original.createdAt))}
      </span>
    ),
  },
];

const EMPTY: TicketRow[] = [];

// A sentinel value used by the Select components to represent "no filter"
// (Select requires a string value; empty string maps to `undefined` on output).
const ALL = "__all__";

export default function TicketsTable({
  tickets,
  isPending = false,
  sorting,
  onSortingChange,
  filters,
  onFiltersChange,
  pagination,
  onPaginationChange,
  pageCount,
  total,
}: {
  tickets?: TicketRow[];
  isPending?: boolean;
  sorting: SortingState;
  onSortingChange: OnChangeFn<SortingState>;
  filters: TicketFilters;
  onFiltersChange: (f: TicketFilters) => void;
  pagination: PaginationState;
  onPaginationChange: OnChangeFn<PaginationState>;
  pageCount: number;
  total: number;
}) {
  const table = useReactTable({
    data: tickets ?? EMPTY,
    columns,
    state: { sorting, pagination },
    onSortingChange,
    onPaginationChange,
    manualSorting: true, // the server does the sorting
    manualPagination: true, // the server does the paging (skip/take)
    pageCount,
    getCoreRowModel: getCoreRowModel(),
  });

  const hasActiveFilter = Boolean(
    filters.status ?? filters.category ?? filters.search,
  );

  return (
    <div className="space-y-3">
      {/* ── Filter bar ──────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        {/* Search input — value is the live (undebounced) input; debouncing
            is handled in TicketsPage so the input stays responsive. */}
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            placeholder="Search tickets…"
            aria-label="Search tickets"
            value={filters.search ?? ""}
            onChange={(e) =>
              onFiltersChange({ ...filters, search: e.target.value || undefined })
            }
            className="h-8 w-64 pl-8 text-sm"
          />
        </div>

        <Select
          value={filters.status ?? ALL}
          onValueChange={(v) =>
            onFiltersChange({
              ...filters,
              status: v === ALL ? undefined : (v as TicketStatus),
            })
          }
        >
          <SelectTrigger
            size="sm"
            className="w-36"
            aria-label="Filter by status"
          >
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="resolved">Resolved</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={filters.category ?? ALL}
          onValueChange={(v) =>
            onFiltersChange({
              ...filters,
              category: v === ALL ? undefined : (v as TicketCategory),
            })
          }
        >
          <SelectTrigger
            size="sm"
            className="w-40"
            aria-label="Filter by category"
          >
            <SelectValue placeholder="All categories" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All categories</SelectItem>
            <SelectItem value="general">General</SelectItem>
            <SelectItem value="technical">Technical</SelectItem>
            <SelectItem value="refund">Refund</SelectItem>
          </SelectContent>
        </Select>

        {hasActiveFilter && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onFiltersChange({})}
            className="h-8 gap-1 text-muted-foreground"
            aria-label="Clear all filters"
          >
            <X className="size-3.5" />
            Clear
          </Button>
        )}
      </div>

      {/* ── Table ────────────────────────────────────────────────────────── */}
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((headerGroup) => (
            <TableRow key={headerGroup.id}>
              {headerGroup.headers.map((header) => {
                const sorted = header.column.getIsSorted();
                const Icon =
                  sorted === "asc"
                    ? ArrowUp
                    : sorted === "desc"
                      ? ArrowDown
                      : ChevronsUpDown;
                return (
                  <TableHead key={header.id}>
                    <button
                      type="button"
                      onClick={header.column.getToggleSortingHandler()}
                      className="-ml-1 inline-flex items-center gap-1 rounded-md px-1 py-0.5 font-medium transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label={`Sort by ${String(header.column.columnDef.header)}`}
                    >
                      {flexRender(
                        header.column.columnDef.header,
                        header.getContext(),
                      )}
                      <Icon
                        className={cn(
                          "size-3.5",
                          sorted
                            ? "text-foreground"
                            : "text-muted-foreground/60",
                        )}
                      />
                    </button>
                  </TableHead>
                );
              })}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {isPending ? (
            Array.from({ length: SKELETON_ROWS }).map((_, i) => (
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
          ) : (tickets ?? EMPTY).length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={columns.length}
                className="h-24 text-center text-sm text-muted-foreground"
              >
                No tickets match the current filters.
              </TableCell>
            </TableRow>
          ) : (
            table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {/* ── Pagination ───────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          {total} ticket{total === 1 ? "" : "s"}
        </p>
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">
            Page {pagination.pageIndex + 1} of {pageCount}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            aria-label="Previous page"
          >
            <ChevronLeft className="size-3.5" />
            Prev
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            aria-label="Next page"
          >
            Next
            <ChevronRight className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
