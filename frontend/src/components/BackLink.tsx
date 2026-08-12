import type { ComponentProps } from "react";
import { ArrowLeft } from "lucide-react";
import { TextLink } from "@/components/ui/link";
import { cn } from "@/lib/utils";

// A muted "← back to somewhere" link, sized to sit above a page's content.
// Takes everything TextLink does, so the caller supplies `to` and the label:
// <BackLink to="/tickets">Back to tickets</BackLink>
export default function BackLink({
  className,
  children,
  ...props
}: ComponentProps<typeof TextLink>) {
  return (
    <TextLink
      variant="muted"
      className={cn("inline-flex items-center gap-1 text-sm", className)}
      {...props}
    >
      <ArrowLeft className="size-3.5" />
      {children}
    </TextLink>
  );
}
