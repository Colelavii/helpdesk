const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;

// A duration in minutes as compact display text: "42m", "2h 15m", "3d 4h".
//
// Two units at most — a dashboard figure is read at a glance, and "3d 4h 12m"
// spends a third unit on precision nobody acts on. The smaller unit is dropped
// when it's zero ("2h", not "2h 0m"). Null renders as an em dash: the metric it
// carries is null when nothing has been resolved yet, which is not the same
// thing as zero.
export function formatDuration(minutes: number | null): string {
  if (minutes === null) return "—";

  const total = Math.max(0, Math.round(minutes));
  if (total < MINUTES_PER_HOUR) return `${total}m`;

  if (total < MINUTES_PER_DAY) {
    const hours = Math.floor(total / MINUTES_PER_HOUR);
    const remainder = total % MINUTES_PER_HOUR;
    return remainder === 0 ? `${hours}h` : `${hours}h ${remainder}m`;
  }

  const days = Math.floor(total / MINUTES_PER_DAY);
  const hours = Math.floor((total % MINUTES_PER_DAY) / MINUTES_PER_HOUR);
  return hours === 0 ? `${days}d` : `${days}d ${hours}h`;
}
