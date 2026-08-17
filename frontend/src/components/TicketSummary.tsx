import { useMutation } from "@tanstack/react-query";
import axios from "axios";
import { Sparkles } from "lucide-react";
import type { TicketWithThread } from "@helpdesk/core";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import ErrorMessage from "@/components/ErrorMessage";
import { apiErrorMessage } from "@/lib/api-error";

// An on-demand AI summary of the ticket and its conversation, shown under the
// thread. Deliberately a mutation rather than a query: the summary is never
// cached, so each click regenerates it against the thread as it currently
// stands. Takes the whole ticket (like MessageThread) so callers pass the
// object they already hold.
export default function TicketSummary({
  ticket,
}: {
  ticket: TicketWithThread;
}) {
  const summarize = useMutation({
    mutationFn: async () => {
      const { data } = await axios.post<{ summary: string }>(
        `/api/tickets/${ticket.id}/summary`,
      );
      return data.summary;
    },
  });

  const hasMessages = ticket.messages.length > 0;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-heading text-base font-medium">Summary</h2>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={!hasMessages || summarize.isPending}
            onClick={() => summarize.mutate()}
          >
            <Sparkles />
            {summarize.isPending
              ? "Summarising…"
              : summarize.data
                ? "Regenerate"
                : "Summarize"}
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {summarize.isPending ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-11/12" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        ) : summarize.isError ? (
          <ErrorMessage>
            {apiErrorMessage(
              summarize.error,
              "Unable to summarise this ticket. Please try again.",
            )}
          </ErrorMessage>
        ) : summarize.data ? (
          <p className="leading-relaxed whitespace-pre-wrap">
            {summarize.data}
          </p>
        ) : (
          <p className="text-muted-foreground">
            {hasMessages
              ? "Summarize this ticket and its conversation history."
              : "Nothing to summarize yet — this ticket has no messages."}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
