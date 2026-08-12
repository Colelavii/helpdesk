import type { Ticket } from "@helpdesk/core";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { linkVariants } from "@/components/ui/link";
import Field from "@/components/Field";
import { cn } from "@/lib/utils";

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

// The ticket's fixed facts — what it's about, who raised it, and when. The
// conversation lives in MessageThread and the editable fields in the detail
// page's sidebar. Takes the whole ticket so callers pass the object they hold.
export default function TicketDetail({ ticket }: { ticket: Ticket }) {
  return (
    <Card>
      <CardHeader>
        <h1 className="font-heading text-xl leading-snug font-semibold">
          {ticket.subject}
        </h1>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
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
  );
}
