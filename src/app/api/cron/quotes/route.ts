import { createHash, timingSafeEqual } from "node:crypto";
import { getDb } from "@/lib/db";
import { marketSession } from "@/lib/market-hours";
import { warmQuotes } from "@/lib/portfolio/warm-quotes";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Refreshes the price cache on a schedule, so no page load ever has to.
 *
 * Call it every minute; it decides for itself whether there is anything to
 * do. During the regular session it refreshes at most once a minute, and in
 * pre-market and after-hours at most once every half hour — those sessions
 * trade thinly enough that a half-hourly price is honest, and it keeps the
 * broker's rate limit for the hours that matter.
 *
 * Guarding the cadence here rather than trusting the scheduler means a
 * misconfigured pinger calling every second costs one cheap query, not a
 * rate-limit ban.
 */
const MIN_GAP_MS: Record<string, number> = {
  regular: 55_000,
  "pre-market": 29 * 60_000,
  "after-hours": 29 * 60_000,
};

export async function GET(request: Request) {
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

  const now = new Date();
  const session = marketSession(now);
  const gap = MIN_GAP_MS[session];
  if (gap === undefined) {
    return Response.json({ warmed: false, reason: "Market closed" });
  }

  // How long since anything was last priced. One row, one index.
  const db = await getDb();
  const latest = await db.get<{ cached_at: string | null }>(
    `SELECT MAX(cached_at) AS cached_at FROM quote_cache`,
  );
  const age = latest?.cached_at
    ? now.getTime() - new Date(latest.cached_at).getTime()
    : Infinity;

  if (age < gap) {
    return Response.json({
      warmed: false,
      reason: "Already fresh",
      ageSeconds: Math.round(age / 1000),
    });
  }

  return Response.json(await warmQuotes(now));
}
