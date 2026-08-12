import { Skeleton } from "@/components/ui/skeleton";

// Placeholder for the detail page while the ticket loads. Mirrors the loaded
// layout's two-column grid so the content doesn't shift when it arrives.
export default function TicketDetailSkeleton() {
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-40 w-full" />
      </div>
      <Skeleton className="h-56 w-full" />
    </div>
  );
}
