import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import {
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
                {Object.values(TicketStatus).map((status) => (
                  <SelectItem key={status} value={status} className="capitalize">
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
                {assignees.map((user) => (
                  <SelectItem key={user.id} value={user.id}>
                    {user.name}
                  </SelectItem>
                ))}
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
