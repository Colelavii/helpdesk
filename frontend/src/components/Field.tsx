import type { ReactNode } from "react";

// A labelled description-list entry: an uppercase <dt> label above its <dd>
// value. Render inside a <dl>.
export default function Field({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1">
      <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {label}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}
