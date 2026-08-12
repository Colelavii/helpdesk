import { useQuery } from "@tanstack/react-query";
import { useParams } from "react-router-dom";
import axios from "axios";
import { TicketStatus, TicketCategory } from "@helpdesk/core";
import BackLink from "@/components/BackLink";
import TicketDetail from "@/components/TicketDetail";
import TicketDetailSkeleton from "@/components/TicketDetailSkeleton";
import ReplyForm from "@/components/ReplyForm";
import UpdateTicket from "@/components/UpdateTicket";
import ErrorMessage from "@/components/ErrorMessage";
import MessageThread, {
  type TicketMessage,
} from "@/components/MessageThread";
import { ticketQueryKey } from "@/lib/query-keys";

// Named Ticket rather than TicketDetail so it doesn't shadow the component of
// that name; this is the full detail-endpoint payload.
interface Ticket {
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

async function fetchTicket(id: string, signal: AbortSignal): Promise<Ticket> {
  const { data } = await axios.get<{ ticket: Ticket }>(`/api/tickets/${id}`, {
    signal,
  });
  return data.ticket;
}

export default function TicketDetailPage() {
  const { id } = useParams<{ id: string }>();

  const {
    data: ticket,
    isPending,
    isError,
    error,
  } = useQuery({
    queryKey: ticketQueryKey(id as string),
    queryFn: ({ signal }) => fetchTicket(id as string, signal),
    enabled: id !== undefined,
  });

  const notFound = axios.isAxiosError(error) && error.response?.status === 404;

  return (
    <section className="mx-auto w-full max-w-5xl space-y-6">
      <BackLink to="/tickets">Back to tickets</BackLink>

      {isPending ? (
        <TicketDetailSkeleton />
      ) : isError ? (
        <ErrorMessage>
          {notFound
            ? "This ticket could not be found."
            : "Unable to load this ticket."}
        </ErrorMessage>
      ) : (
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Left column — subject, requester, and the conversation */}
          <div className="space-y-6 lg:col-span-2">
            <TicketDetail ticket={ticket} />

            <MessageThread ticket={ticket} />

            <ReplyForm ticket={ticket} />
          </div>

          {/* Right column — editable controls (all dropdowns) */}
          <div className="space-y-6">
            <UpdateTicket ticket={ticket} />
          </div>
        </div>
      )}
    </section>
  );
}
