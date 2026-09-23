"use client";

import { useEffect, useRef, useState } from "react";
import { HelpCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A question mark that explains what something is, in words a person who has
 * never traded would understand.
 *
 * The rule for what goes inside: no jargon, or if a term has to appear,
 * define it in the same sentence. "Unrealized" is not an explanation;
 * "profit you have on paper, because you still own the thing" is. Anything
 * that reads like a finance textbook has failed and should be rewritten.
 *
 * A popover rather than a tooltip, because a tooltip cannot be opened by
 * touch and this is read on phones more than anywhere else.
 */
export function Help({
  title,
  children,
  align = "left",
}: {
  title: string;
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const holder = useRef<HTMLSpanElement>(null);

  // Clicking anywhere else closes it, and so does Escape. Without both, a
  // phone leaves the panel stuck open over whatever you meant to tap next.
  useEffect(() => {
    if (!open) return;

    function onPointer(event: MouseEvent | TouchEvent) {
      if (!holder.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", onPointer);
    document.addEventListener("touchstart", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("touchstart", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span ref={holder} className="relative inline-flex align-middle">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-label={title}
        className="inline-flex size-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <HelpCircle className="size-3.5" aria-hidden="true" />
      </button>

      {open && (
        <span
          role="note"
          className={cn(
            "absolute top-6 z-40 w-64 rounded-xl border border-border bg-surface p-3 text-left shadow-lg",
            align === "right" ? "right-0" : "left-0",
          )}
        >
          <span className="block text-xs font-medium">{title}</span>
          <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">
            {children}
          </span>
        </span>
      )}
    </span>
  );
}
