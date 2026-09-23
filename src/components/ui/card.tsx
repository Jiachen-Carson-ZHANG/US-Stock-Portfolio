import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "elevated rounded-2xl border border-border bg-surface",
        className,
      )}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("px-3.5 pt-4 pb-2.5 sm:px-5 sm:pt-5 sm:pb-3", className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.ComponentProps<"h3">) {
  return (
    <h3
      className={cn(
        "text-xs font-medium uppercase tracking-wider text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

/**
 * Tighter on a phone than on a desktop.
 *
 * The same 20px of padding that gives a card room on a monitor eats a third
 * of the width of a phone, which is how four figures ended up needing a full
 * screen of scrolling each.
 */
export function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("px-3.5 pb-4 sm:px-5 sm:pb-5", className)} {...props} />;
}
