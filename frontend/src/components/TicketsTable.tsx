import {
  type ColumnDef,
  type OnChangeFn,
  type SortingState,
  flexRender,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
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

const dateFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "numeric",
});

const SKELETON_ROWS = 5;

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
    cell: ({ row }) => <span className="capitalize">{row.original.status}</span>,
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

export default function TicketsTable({
  tickets,
  isPending = false,
  sorting,
  onSortingChange,
}: {
  tickets?: TicketRow[];
  isPending?: boolean;
  sorting: SortingState;
  onSortingChange: OnChangeFn<SortingState>;
}) {
  const table = useReactTable({
    data: tickets ?? EMPTY,
    columns,
    state: { sorting },
    onSortingChange,
    manualSorting: true, // the server does the sorting
    getCoreRowModel: getCoreRowModel(),
  });

  return (
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
                        sorted ? "text-foreground" : "text-muted-foreground/60",
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
          : table.getRowModel().rows.map((row) => (
              <TableRow key={row.id}>
                {row.getVisibleCells().map((cell) => (
                  <TableCell key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </TableCell>
                ))}
              </TableRow>
            ))}
      </TableBody>
    </Table>
  );
}
