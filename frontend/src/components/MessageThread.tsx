import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export interface TicketMessage {
  id: number;
  direction: "inbound" | "outbound";
  fromEmail: string;
  fromName: string;
  body: string;
  createdAt: string;
}

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

// Takes the whole ticket rather than its messages array so callers pass the
// object they already hold; the prop is structural, so any ticket shape with a
// messages thread satisfies it.
export default function MessageThread({
  ticket,
}: {
  ticket: { messages: TicketMessage[] };
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
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
