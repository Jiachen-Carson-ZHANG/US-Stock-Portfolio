"use client";

import { useClock } from "@/lib/local-time";

const DEFAULT: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
};

/** A moment in the viewer's own clock, without upsetting the first render. */
export function Clock({
  iso,
  options = DEFAULT,
}: {
  iso: string | null | undefined;
  options?: Intl.DateTimeFormatOptions;
}) {
  return <>{useClock(iso, options)}</>;
}
