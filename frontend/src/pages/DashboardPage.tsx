import { useQuery } from "@tanstack/react-query";
import axios from "axios";
import type { TicketStats, TicketsPerDay } from "@helpdesk/core";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import StatCard from "@/components/StatCard";
import TicketsPerDayChart from "@/components/TicketsPerDayChart";
import ErrorMessage from "@/components/ErrorMessage";
import { formatDuration } from "@/lib/format-duration";

interface StatsResponse {
  stats: TicketStats;
  daily: TicketsPerDay[];
}

async function fetchStats(signal: AbortSignal): Promise<StatsResponse> {
  const { data } = await axios.get<StatsResponse>("/api/tickets/stats", {
    signal,
  });
  return data;
}

const numberFormatter = new Intl.NumberFormat();

export default function DashboardPage() {
  const { data, isPending, isError, isFetching } = useQuery({
    queryKey: ["ticket-stats"],
    queryFn: ({ signal }) => fetchStats(signal),
  });

  const stats = data?.stats;

  const tiles = [
    {
      label: "Total tickets",
      value: stats ? numberFormatter.format(stats.total) : "",
      hint: "All tickets ever received",
    },
    {
      label: "Open tickets",
      value: stats ? numberFormatter.format(stats.open) : "",
      hint: "Waiting on a human",
    },
    {
      label: "Resolved by AI",
      value: stats ? numberFormatter.format(stats.aiResolved) : "",
      hint: "Answered from the knowledge base",
    },
    {
      label: "% resolved by AI",
      value:
        stats?.aiResolvedPercent === null
          ? "—"
          : `${stats?.aiResolvedPercent ?? 0}%`,
      // The ratio it came from, so the percentage can be checked at a glance.
      hint: stats
        ? `${numberFormatter.format(stats.aiResolved)} of ${numberFormatter.format(stats.concluded)} concluded tickets`
        : undefined,
    },
    {
      label: "Average resolution time",
      value: formatDuration(stats?.averageResolutionMinutes ?? null),
      hint: "From arrival to resolved",
    },
  ];

  return (
    <section className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          How much support work is arriving, and how much of it the AI is
          handling.
        </p>
      </div>

      {isError ? (
        <ErrorMessage>Unable to load dashboard statistics.</ErrorMessage>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {tiles.map((tile) => (
              <StatCard
                key={tile.label}
                label={tile.label}
                value={tile.value}
                hint={tile.hint}
                isPending={isPending}
              />
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Tickets per day</CardTitle>
              <CardDescription>
                Tickets created each day over the last 30 days.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <TicketsPerDayChart
                data={data?.daily}
                isPending={isPending}
                isStale={isFetching && !isPending}
              />
            </CardContent>
          </Card>
        </>
      )}
    </section>
  );
}
