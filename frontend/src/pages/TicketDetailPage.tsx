import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import axios from "axios";
import { ArrowLeft } from "lucide-react";
import type { TicketStatus, TicketCategory } from "@helpdesk/core";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { TextLink, linkVariants } from "@/components/ui/link";
import { cn } from "@/lib/utils";
import { statusVariant } from "@/components/TicketsTable";

interface TicketMessage {
  id: number;
  direction: "inbound" | "outbound";
  fromEmail: string;
  fromName: string;
  body: string;
  createdAt: string;
}

interface TicketDetail {
  id: number;
  subject: string;
  requesterEmail: string;
  requesterName: string;
  status: TicketStatus;
  category: TicketCategory | null;
  assignedTo: { id: string; name: string; email: string } | null;
  createdAt: string;
  updatedAt: string;
  messages: TicketMessage[];
}

interface Assignee {
  id: string;
  name: string;
  email: string;
}

// Sentinel for the "no assignee" option (Select values must be non-empty strings).
const UNASSIGNED = "__unassigned__";

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

async function fetchTicket(
  id: string,
  signal: AbortSignal,
): Promise<TicketDetail> {
  const { data } = await axios.get<{ ticket: TicketDetail }>(
    `/api/tickets/${id}`,
    { signal },
  );
  return data.ticket;
}

async function fetchAssignees(signal: AbortSignal): Promise<Assignee[]> {
  const { data } = await axios.get<{ users: Assignee[] }>(
    "/api/tickets/assignees",
    { signal },
  );
  return data.users;
}

export default function TicketDetailPage() {
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();

  const {
    data: ticket,
    isPending,
    isError,
    error,
  } = useQuery({
    queryKey: ["ticket", id],
    queryFn: ({ signal }) => fetchTicket(id as string, signal),
    enabled: id !== undefined,
  });

  const { data: assignees = [] } = useQuery({
    queryKey: ["assignees"],
    queryFn: ({ signal }) => fetchAssignees(signal),
  });

  const assignMutation = useMutation({
    mutationFn: (assignedToId: string | null) =>
      axios.patch(`/api/tickets/${id}`, { assignedToId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["ticket", id] });
    },
  });

  const notFound = axios.isAxiosError(error) && error.response?.status === 404;

  return (
    <section className="mx-auto w-full max-w-3xl space-y-6">
      <TextLink
        to="/tickets"
        variant="muted"
        className="inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-3.5" />
        Back to tickets
      </TextLink>

      {isPending ? (
        <div className="space-y-6">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-36 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : isError ? (
        <p role="alert" className="text-sm text-destructive">
          {notFound
            ? "This ticket could not be found."
            : "Unable to load this ticket."}
        </p>
      ) : (
        <>
          {/* Summary */}
          <Card>
            <CardHeader>
              <h1 className="font-heading text-xl leading-snug font-semibold">
                {ticket.subject}
              </h1>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
                <Field label="Status">
                  <Badge variant={statusVariant[ticket.status]}>
                    {ticket.status}
                  </Badge>
                </Field>
                <Field label="Category">
                  <Badge variant="outline" className="capitalize">
                    {ticket.category ?? "uncategorised"}
                  </Badge>
                </Field>
                <Field label="Assigned to">
                  <Select
                    value={ticket.assignedTo?.id ?? UNASSIGNED}
                    onValueChange={(value) =>
                      assignMutation.mutate(
                        value === UNASSIGNED ? null : value,
                      )
                    }
                    disabled={assignMutation.isPending}
                  >
                    <SelectTrigger
                      size="sm"
                      className="w-full"
                      aria-label="Assign ticket"
                    >
                      <SelectValue placeholder="Unassigned" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNASSIGNED}>Unassigned</SelectItem>
                      {assignees.map((user) => (
                        <SelectItem key={user.id} value={user.id}>
                          {user.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {assignMutation.isError && (
                    <p role="alert" className="text-sm text-destructive">
                      Couldn't update the assignee.
                    </p>
                  )}
                </Field>
                <Field label="Requester">
                  <span className="font-medium">{ticket.requesterName}</span>
                  <a
                    href={`mailto:${ticket.requesterEmail}`}
                    className={cn(linkVariants({ variant: "muted" }), "block text-sm")}
                  >
                    {ticket.requesterEmail}
                  </a>
                </Field>
                <Field label="Opened">
                  <span className="text-sm">
                    {dateTimeFormatter.format(new Date(ticket.createdAt))}
                  </span>
                </Field>
              </dl>
            </CardContent>
          </Card>

          {/* Conversation */}
          <div className="space-y-3">
            <h2 className="text-sm font-medium text-muted-foreground">
              Conversation
            </h2>
            {ticket.messages.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No messages on this ticket yet.
              </p>
            ) : (
              <div className="space-y-4">
                {ticket.messages.map((message) => (
                  <Card
                    key={message.id}
                    className={cn(
                      "border-l-4",
                      message.direction === "inbound"
                        ? "border-l-border"
                        : "border-l-primary",
                    )}
                  >
                    <CardHeader>
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <div className="min-w-0">
                          <span className="font-medium">
                            {message.fromName}
                          </span>{" "}
                          <span className="text-sm text-muted-foreground">
                            &lt;{message.fromEmail}&gt;
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge
                            variant={
                              message.direction === "inbound"
                                ? "secondary"
                                : "default"
                            }
                          >
                            {message.direction}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {dateTimeFormatter.format(
                              new Date(message.createdAt),
                            )}
                          </span>
                        </div>
                      </div>
                    </CardHeader>
                    <CardContent className="text-sm leading-relaxed whitespace-pre-wrap">
                      {message.body}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </section>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}
