import * as React from "react";
import { cn } from "@/lib/utils";

export function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      className={cn(
        "block text-sm font-medium tracking-tight text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export function Input({ className, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "min-h-11 w-full rounded-xl border border-border bg-background px-3.5 py-2 text-base",
        "transition-[border-color,box-shadow] duration-150",
        "placeholder:text-muted-foreground/70",
        "hover:border-muted-foreground/40",
        "focus-visible:border-accent focus-visible:outline-none",
        "focus-visible:ring-4 focus-visible:ring-accent/10",
        className,
      )}
      {...props}
    />
  );
}
