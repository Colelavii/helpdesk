import type { TicketMessage, TicketWithThread } from "@helpdesk/core";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import ErrorMessage from "@/components/ErrorMessage";
import { cn } from "@/lib/utils";

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

// Delivery state is only meaningful for a reply we tried to send — an inbound
// message was delivered to us by definition. A successfully sent reply gets no
// badge at all: that is the expected case, and badging it would put a label on
// every message in the thread that says nothing.
function DeliveryBadge({ message }: { message: TicketMessage }) {
  if (message.direction !== "outbound") return null;
  if (message.deliveryError) {
    return <Badge variant="destructive">Delivery failed</Badge>;
  }
  // Covers three states that are all "the student hasn't received this":
  // queued a moment ago, sending not configured, or a reply written before
  // outbound email existed.
  if (!message.sentAt) return <Badge variant="outline">Not sent</Badge>;
  return null;
}

// Takes the whole ticket rather than its messages array so callers pass the
// object they already hold.
export default function MessageThread({
  ticket,
}: {
  ticket: TicketWithThread;
}) {
  return (
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
                    <span className="font-medium">{message.fromName}</span>{" "}
                    <span className="text-sm text-muted-foreground">
                      &lt;{message.fromEmail}&gt;
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <DeliveryBadge message={message} />
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
                      {dateTimeFormatter.format(new Date(message.createdAt))}
                    </span>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="text-sm leading-relaxed whitespace-pre-wrap">
                {message.body}
                {message.deliveryError ? (
                  <ErrorMessage className="mt-3 whitespace-normal">
                    {message.deliveryError}
                  </ErrorMessage>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
