"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * False while the page is being hydrated from the server's HTML, true after.
 *
 * Anything written in the viewer's own clock or language has to wait for
 * this. The server renders in UTC with its own locale; a phone in Singapore
 * renders "05:17 PM GMT+8" or "27 Sept 2026" for the same moment, React
 * finds text that does not match, and throws the page's first render away —
 * the "Minified React error #418" in the logs, on almost every dashboard.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}

/**
 * A moment, in the viewer's clock once the page has loaded and in New York
 * time until then — both server and browser agree on New York, so the first
 * render matches, and the market's own zone is a fair thing to show for a
 * split second.
 */
export function useClock(iso: string | null | undefined, options: Intl.DateTimeFormatOptions): string {
  const hydrated = useHydrated();
  if (!iso) return "—";
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "—";
  return hydrated
    ? date.toLocaleString(undefined, { ...options, timeZoneName: "short" })
    : `${date.toLocaleString("en-US", { ...options, timeZone: "America/New_York" })} ET`;
}

/**
 * A calendar day, the same everywhere: in the app's language rather than the
 * device's, and read as a date rather than a moment, so no timezone can move
 * it to the day before.
 */
export function formatDay(day: string, locale: "en" | "zh"): string {
  const date = new Date(`${day.slice(0, 10)}T12:00:00Z`);
  if (!Number.isFinite(date.getTime())) return day;
  return date.toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
