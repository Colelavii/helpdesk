import { Card, CardDescription, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// One headline figure on the dashboard. The label sits above the value so a row
// of these reads as a list of questions with answers, and `hint` carries the
// arithmetic behind a derived figure (e.g. which two numbers a percentage came
// from) so it can be checked without a chart.
export default function StatCard({
  label,
  value,
  hint,
  isPending = false,
}: {
  label: string;
  value: string;
  hint?: string;
  isPending?: boolean;
}) {
  return (
    <Card>
      <CardHeader className="gap-2">
        <CardDescription>{label}</CardDescription>
        {isPending ? (
          <Skeleton className="h-9 w-24" />
        ) : (
          <p className="text-3xl font-semibold tracking-tight">{value}</p>
        )}
        {isPending ? (
          <Skeleton className="h-4 w-32" />
        ) : (
          // Reserve the line even without a hint, so tiles in a row stay the
          // same height whether or not they have one.
          <p className="text-sm text-muted-foreground">{hint ?? " "}</p>
        )}
      </CardHeader>
    </Card>
  );
}
