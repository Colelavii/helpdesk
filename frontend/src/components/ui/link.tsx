import * as React from "react";
import { Link as RouterLink } from "react-router-dom";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

// Shared link styling so we don't repeat `text-foreground` / `hover:underline`
// on every anchor. Use <TextLink> for react-router links; for a plain <a>
// (e.g. mailto:) apply linkVariants() to its className.
export const linkVariants = cva("transition-colors", {
  variants: {
    variant: {
      // Inline content link (e.g. a ticket subject).
      default: "text-foreground underline-offset-4 hover:underline",
      // Lower-emphasis link that brightens on hover (back links, emails).
      muted:
        "text-muted-foreground underline-offset-4 hover:text-foreground hover:underline",
      // Nav-bar link: no underline, brightens on hover.
      nav: "text-sm font-medium text-muted-foreground hover:text-foreground",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

export function TextLink({
  className,
  variant,
  ...props
}: React.ComponentProps<typeof RouterLink> &
  VariantProps<typeof linkVariants>) {
  return (
    <RouterLink
      data-slot="link"
      className={cn(linkVariants({ variant }), className)}
      {...props}
    />
  );
}
