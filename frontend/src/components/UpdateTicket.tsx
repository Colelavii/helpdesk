import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import {
  agentTicketStatuses,
  TicketStatus,
  TicketCategory,
  type TicketAssignee,
  type TicketWithThread,
} from "@helpdesk/core";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import Field from "@/components/Field";
import ErrorMessage from "@/components/ErrorMessage";
import { ticketQueryKey } from "@/lib/query-keys";

interface TicketUpdate {
  assignedToId?: string | null;
  status?: TicketStatus;
  category?: TicketCategory | null;
}

// Sentinels for the "empty" options (Select values must be non-empty strings).
const UNASSIGNED = "__unassigned__";
const UNCATEGORISED = "__uncategorised__";

// Agents own open/resolved/closed; `new` and `processing` belong to the
// auto-resolve worker and the PATCH route rejects them. They still have to
// appear — disabled — while a ticket is actually in one, because the trigger
// renders the matching item's label and would otherwise sit blank on a ticket
// opened by direct URL mid-auto-resolve.
function statusOptions(
  current: TicketStatus,
): { status: TicketStatus; selectable: boolean }[] {
  const selectable = agentTicketStatuses.map((status) => ({
    status,
    selectable: true,
  }));

  return agentTicketStatuses.includes(
    current as (typeof agentTicketStatuses)[number],
  )
    ? selectable
    : [{ status: current, selectable: false }, ...selectable];
}

// Same problem as statusOptions, for the same reason: the trigger renders the
// matching item's label, so an assignee missing from the picker's list would
// leave it showing the "Unassigned" placeholder — claiming nobody owns a ticket
// that someone does. The AI agent is deliberately excluded from /assignees (it
// must not be assignable by hand) yet owns every ticket in the auto-resolve
// window, so this is the normal case, not an edge one.
function assigneeOptions(
  assignees: TicketAssignee[],
  current: TicketAssignee | null,
): { user: TicketAssignee; selectable: boolean }[] {
  const selectable = assignees.map((user) => ({ user, selectable: true }));

  return !current || assignees.some((user) => user.id === current.id)
    ? selectable
    : [{ user: current, selectable: false }, ...selectable];
}

async function fetchAssignees(signal: AbortSignal): Promise<TicketAssignee[]> {
  const { data } = await axios.get<{ users: TicketAssignee[] }>(
    "/api/tickets/assignees",
    { signal },
  );
  return data.users;
}

// The editable side of a ticket: status, category, and assignee. Owns its own
// PATCH (like ReplyForm owns its POST) and re-fetches the ticket on success, so
// callers only hand it the ticket.
export default function UpdateTicket({
  ticket,
}: {
  ticket: TicketWithThread;
}) {
  const queryClient = useQueryClient();

  const { data: assignees = [] } = useQuery({
    queryKey: ["assignees"],
    queryFn: ({ signal }) => fetchAssignees(signal),
  });

  const updateMutation = useMutation({
    mutationFn: (patch: TicketUpdate) =>
      axios.patch(`/api/tickets/${ticket.id}`, patch),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ticketQueryKey(ticket.id) });
    },
  });

  return (
    <Card>
      <CardHeader>
        <h2 className="font-heading text-base font-medium">Details</h2>
      </CardHeader>
      <CardContent>
        <dl className="space-y-4">
          <Field label="Status">
            <Select
              value={ticket.status}
              onValueChange={(value) =>
                updateMutation.mutate({ status: value as TicketStatus })
              }
              disabled={updateMutation.isPending}
            >
              <SelectTrigger
                size="sm"
                className="w-full capitalize"
                aria-label="Ticket status"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {statusOptions(ticket.status).map(({ status, selectable }) => (
                  <SelectItem
                    key={status}
                    value={status}
                    disabled={!selectable}
                    className="capitalize"
                  >
                    {status}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Category">
            <Select
              value={ticket.category ?? UNCATEGORISED}
              onValueChange={(value) =>
                updateMutation.mutate({
                  category:
                    value === UNCATEGORISED ? null : (value as TicketCategory),
                })
              }
              disabled={updateMutation.isPending}
            >
              <SelectTrigger
                size="sm"
                className="w-full capitalize"
                aria-label="Ticket category"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNCATEGORISED}>Uncategorised</SelectItem>
                {Object.values(TicketCategory).map((category) => (
                  <SelectItem
                    key={category}
                    value={category}
                    className="capitalize"
                  >
                    {category}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Assigned to">
            <Select
              value={ticket.assignedTo?.id ?? UNASSIGNED}
              onValueChange={(value) =>
                updateMutation.mutate({
                  assignedToId: value === UNASSIGNED ? null : value,
                })
              }
              disabled={updateMutation.isPending}
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
                {assigneeOptions(assignees, ticket.assignedTo).map(
                  ({ user, selectable }) => (
                    <SelectItem
                      key={user.id}
                      value={user.id}
                      disabled={!selectable}
                    >
                      {user.name}
                    </SelectItem>
                  ),
                )}
              </SelectContent>
            </Select>
          </Field>
        </dl>
        {updateMutation.isError && (
          <ErrorMessage className="mt-4">
            Couldn't update the ticket. Please try again.
          </ErrorMessage>
        )}
      </CardContent>
    </Card>
  );
}
