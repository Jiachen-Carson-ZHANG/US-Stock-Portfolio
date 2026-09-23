"use client";

import Link from "next/link";

/**
 * A failure inside the app keeps the app around it.
 *
 * The root error screen replaces everything, sidebar included, so one page
 * failing looked like the whole site had. Here the navigation stays and only
 * the content is replaced, which is both truer and far less alarming — every
 * other tab still works, and the reader can prove it by clicking one.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-8 text-center">
      <h1 className="text-base font-semibold tracking-tight">
        This page could not be loaded
      </h1>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
        Everything else still works — the other tabs are fine, and nothing has
        been lost. Most of these are momentary, so trying again usually does it.
      </p>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={reset}
          className="min-h-11 rounded-xl bg-foreground px-5 text-sm font-medium text-background"
        >
          Try again
        </button>
        <Link
          href="/"
          className="min-h-11 rounded-xl border border-border px-5 text-sm leading-[2.75rem]"
        >
          Back to the overview
        </Link>
      </div>

      {error.digest && (
        <p className="mt-6 text-xs text-muted-foreground">
          Reference <span className="tabular">{error.digest}</span> — an owner
          can look this up under Settings, Speed and activity
        </p>
      )}
    </div>
  );
}
