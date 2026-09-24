"use client";

import { useEffect } from "react";
import {
  looksLikeStaleCode,
  reloadOnceForStaleCode,
  reportClientError,
} from "@/lib/stale-code";

/**
 * Catches a missing script file anywhere on the page, not only inside a
 * route's error boundary.
 *
 * A lazily loaded piece of the page — a chart, a popover — fails outside
 * React's render, so no error boundary ever sees it; the page just stops
 * responding at that spot. Listening at the window catches those too.
 */
export function StaleCodeGuard() {
  useEffect(() => {
    function onError(event: ErrorEvent) {
      const error = event.error ?? event.message;
      reportClientError("uncaught", error);
      if (looksLikeStaleCode(error)) reloadOnceForStaleCode();
    }
    function onRejection(event: PromiseRejectionEvent) {
      reportClientError("unhandled-promise", event.reason);
      if (looksLikeStaleCode(event.reason)) reloadOnceForStaleCode();
    }

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
