"use client";

import { useEffect } from "react";
import {
  looksLikeStaleCode,
  reloadOnceForStaleCode,
  reportClientError,
} from "@/lib/stale-code";

/**
 * A failure inside the app keeps the app around it.
 *
 * The root error screen replaces everything, sidebar included, so one page
 * failing looked like the whole site had. Here the navigation stays and only
 * the content is replaced.
 *
 * Both buttons do a real page load rather than a client-side retry. The most
 * common failure here, by far, is a tab left open across a deploy: its code
 * is older than the server's, and retrying with that same code — which is
 * all React's reset() does — cannot succeed. That is why "Try again" used to
 * do nothing at all. A reload fetches current code and always recovers.
 */
export default function AppError({ error }: { error: Error & { digest?: string } }) {
  // Stale code is recognisable and always fixed by one reload, so do it
  // without waiting to be asked. The reader sees a brief flicker instead of
  // an error screen.
  useEffect(() => {
    // Reported first, so the log has it even when the reload below replaces
    // the page a moment later.
    reportClientError("app-boundary", error, error.digest);
    if (looksLikeStaleCode(error)) reloadOnceForStaleCode();
  }, [error]);

  return (
    <div className="rounded-xl border border-border bg-surface p-8 text-center">
      <h1 className="text-base font-semibold tracking-tight">
        This page could not be loaded
      </h1>
      <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
        Nothing has been lost. If the site was updated while this page was open,
        reloading picks up the new version.
      </p>

      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="min-h-11 rounded-xl bg-foreground px-5 text-sm font-medium text-background"
        >
          Reload
        </button>
        {/* A full page load, not a client-side navigation: if client-side
            navigation is what broke, the way out cannot depend on it. */}
        <button
          type="button"
          // A full load on purpose; router.push is the client-side
          // navigation this screen exists to recover from.
          // eslint-disable-next-line @next/next/no-location-assign-relative-destination
          onClick={() => window.location.assign("/")}
          className="min-h-11 rounded-xl border border-border px-5 text-sm"
        >
          Back to the overview
        </button>
      </div>

      {error.digest && (
        <p className="mt-6 text-xs text-muted-foreground">
          Reference <span className="tabular">{error.digest}</span>
        </p>
      )}
    </div>
  );
}
