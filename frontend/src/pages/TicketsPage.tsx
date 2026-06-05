import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export default function TicketsPage() {
  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Tickets</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Student support requests assigned to your team.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>No tickets yet</CardTitle>
          <CardDescription>
            The ticket list will appear here once tickets start arriving.
          </CardDescription>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          Placeholder for the ticket list.
        </CardContent>
      </Card>
    </section>
  );
}
