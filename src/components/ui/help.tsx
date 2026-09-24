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
        className="inline-flex size-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:size-5"
      >
        <HelpCircle className="size-3.5" aria-hidden="true" />
      </button>

      {open && (
        // On a phone this is a panel across the bottom of the screen rather
        // than a bubble beside the icon. A fixed-width bubble anchored to an
        // icon near either edge ran off the screen, so the explanation — the
        // whole point of the question mark — was cut off mid-sentence, and
        // which edge depended on where the icon happened to sit. Pinned to the
        // viewport it is always fully readable, and sits above the bottom
        // navigation rather than under it.
        <span
          role="note"
          className={cn(
            "fixed inset-x-3 bottom-20 z-50 max-h-[50vh] overflow-y-auto rounded-xl border border-border bg-surface p-4 text-left shadow-xl",
            "sm:absolute sm:inset-x-auto sm:bottom-auto sm:top-6 sm:max-h-none sm:w-72 sm:p-3 sm:shadow-lg",
            align === "right" ? "sm:right-0" : "sm:left-0",
          )}
        >
          <span className="flex items-start justify-between gap-3">
            <span className="block text-sm font-medium sm:text-xs">{title}</span>
            {/* A close control a thumb can find; tapping outside also works. */}
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Close"
              className="-mr-1 -mt-1 inline-flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted sm:hidden"
            >
              ×
            </button>
          </span>
          <span className="mt-1.5 block text-sm leading-relaxed text-muted-foreground sm:mt-1 sm:text-xs">
            {children}
          </span>
        </span>
      )}
    </span>
  );
}
