import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 rounded-xl text-sm font-medium",
    "transition-[background-color,border-color,opacity,transform] duration-150",
    "focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-accent/15",
    "active:translate-y-px",
    "disabled:pointer-events-none disabled:opacity-50",
  ].join(" "),
  {
    variants: {
      variant: {
        primary:
          "bg-accent text-background shadow-[0_1px_2px_rgba(0,0,0,0.12)] hover:opacity-90",
        outline: "border border-border bg-surface hover:bg-muted",
        ghost: "text-muted-foreground hover:bg-muted hover:text-foreground",
      },
      size: {
        // 44px minimum touch target per §24.
        default: "min-h-11 px-4 py-2",
        sm: "min-h-11 px-3 text-sm sm:min-h-9",
        icon: "size-11 sm:size-9",
      },
    },
    defaultVariants: { variant: "primary", size: "default" },
  },
);

export type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean };

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp className={cn(buttonVariants({ variant, size }), className)} {...props} />
  );
}
