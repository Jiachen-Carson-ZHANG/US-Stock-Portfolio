import { createHash, timingSafeEqual } from "node:crypto";
import { getDb } from "@/lib/db";
import { marketSession } from "@/lib/market-hours";
import { warmQuotes } from "@/lib/portfolio/warm-quotes";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Refreshes the price cache on a schedule, so no page load ever has to.
 *
 * A scheduler cannot be asked to call more often than once a minute — that is
 * the floor on every free one — so the handler does the rest itself: it wakes
 * up, and for the next minute it refreshes every ten seconds, then returns.
 * One job on the outside, six refreshes on the inside.
 *
 * Ten seconds during the regular session, and once per invocation in
 * pre-market and after hours, which trade thinly enough that more would spend
 * the broker's rate limit for nothing.
 *
 * It runs all day, not only when the market is open. With the market shut it
 * fetches nothing but still touches the database, and that alone is the point:
 * the hosting tier suspends the database after a few minutes idle and takes
 * around twenty-six seconds to wake it, which was the single biggest source
 * of errors on this site. One cheap query a minute keeps it awake.
 */
const EVERY_MS = 10_000;

/** Stop in time to answer before the platform cuts the function off. */
const BUDGET_MS = 50_000;

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

  const started = Date.now();

  // The keep-awake, and the cheapest possible one. It happens whatever the
  // market is doing — and it leaves a mark, so "is my scheduler actually
  // running?" has an answer instead of being inferred from whether prices
  // look fresh, which says nothing at all when the market is shut.
  const db = await getDb();
  await db.run(
    `INSERT INTO series_cache (key, payload, fetched_at)
     VALUES ('cron:quotes', '"ran"', ?)
     ON CONFLICT(key) DO UPDATE SET fetched_at = excluded.fetched_at`,
    [new Date().toISOString()],
  );

  const session = marketSession(new Date());
  if (session === "closed") {
    return Response.json({ awake: true, warmed: false, reason: "Market closed" });
  }

  // Extended hours: once, and let the next invocation handle the next half
  // hour. Anything faster is spending a rate limit on a price that has not
  // moved.
  if (session !== "regular") {
    const latest = await db.get<{ cached_at: string | null }>(
      `SELECT MAX(cached_at) AS cached_at FROM quote_cache`,
    );
    const age = latest?.cached_at
      ? Date.now() - new Date(latest.cached_at).getTime()
      : Infinity;

    if (age < 29 * 60_000) {
      return Response.json({ awake: true, warmed: false, reason: "Already fresh" });
    }
    return Response.json({ awake: true, ...(await warmQuotes(new Date())) });
  }

  let rounds = 0;
  let symbols = 0;

  while (Date.now() - started < BUDGET_MS) {
    const result = await warmQuotes(new Date());
    rounds += 1;
    symbols = result.symbols;

    const elapsed = Date.now() - started;
    const wait = EVERY_MS - (elapsed % EVERY_MS);
    if (elapsed + wait >= BUDGET_MS) break;
    await new Promise((resolve) => setTimeout(resolve, wait));
  }

  return Response.json({ awake: true, warmed: rounds > 0, rounds, symbols });
}
