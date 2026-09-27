import { createHash, timingSafeEqual } from "node:crypto";
import { rebuildEveryPortfolio } from "@/lib/portfolio/rebuild-accounts";

/**
 * The backstop for portfolio history.
 *
 * Daily capture only records a day if somebody opens the app that evening.
 * Nothing is lost when they do not — a snapshot is a cache of a derivation —
 * but "later" still has to happen, and if nobody visits for a month nothing
 * triggers it. This rebuilds every day in one pass, monthly.
 *
 * Unlike the daily capture it has no deadline: if it fails, the next run
 * rebuilds exactly the same days.
 */
// The hosting plan caps a function at 60 seconds and clamps anything
// higher, so asking for 300 only hid where the real ceiling was.
export const maxDuration = 60;

export async function POST(request: Request) {
  const secret = process.env.SNAPSHOT_CRON_SECRET;
  if (!secret) {
    return Response.json({ error: "Scheduler is not configured" }, { status: 503 });
  }

  const digest = (value: string) => createHash("sha256").update(value).digest();
  if (
    !timingSafeEqual(
      digest(request.headers.get("authorization") ?? ""),
      digest(`Bearer ${secret}`),
    )
  ) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  return Response.json({ results: await rebuildEveryPortfolio() });
}
