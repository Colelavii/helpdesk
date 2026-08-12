import type { ComponentProps } from "react";
import { cn } from "@/lib/utils";

const errorTextClass = "text-sm text-destructive";

// A failed request or action. Renders nothing when there is no message, so call
// sites can pass a possibly-undefined message without their own guard.
export default function ErrorMessage({
  className,
  children,
  ...props
}: ComponentProps<"p">) {
  if (!children) return null;
  return (
    <p role="alert" className={cn(errorTextClass, className)} {...props}>
      {children}
    </p>
  );
}

// A validation message for a single field. Deliberately not role="alert": the
// input's aria-invalid already conveys the state, and a live region per field
// would re-announce as the user types.
export function FieldError({
  className,
  children,
  ...props
}: ComponentProps<"p">) {
  if (!children) return null;
  return (
    <p className={cn(errorTextClass, className)} {...props}>
      {children}
    </p>
  );
}
