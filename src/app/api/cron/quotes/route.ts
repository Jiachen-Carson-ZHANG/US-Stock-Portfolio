import { createHash, timingSafeEqual } from "node:crypto";
import { getDb } from "@/lib/db";
import { isAfterMarketClose, marketDateString, marketSession } from "@/lib/market-hours";
import { awardCompletedPeriods } from "@/lib/arena/trophies";
import { captureDailySnapshots } from "@/lib/portfolio/daily-capture";
import { logger } from "@/lib/logger";
import { matchAllRestingOrders } from "@/lib/portfolio/service";
import { fillHistoryGaps } from "@/lib/portfolio/gap-fill";
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

  // The evening's snapshot of every account. Tried every ten minutes after
  // the close until each account has one, then left alone until tomorrow —
  // this job already runs every minute, so the day no longer depends on a
  // second scheduler nobody set up, or on somebody opening the site at 4am
  // Singapore time.
  if (isAfterMarketClose(new Date())) {
    const evening = await recordEveningSnapshots(db).catch((error: unknown) => {
      logger.error("snapshot.capture.failed", {
        reason: error instanceof Error ? error.message : "unknown",
      });
      return "failed" as const;
    });
    // Once tonight's snapshots are all in — on a later minute than the one
    // that took them, so the two never share a time limit — the days that
    // were missed are filled in.
    if (evening === "done") {
      await fillHistoryGaps(db, new Date()).catch((error: unknown) => {
        logger.error("snapshot.gapfill.failed", {
          reason: error instanceof Error ? error.message : "unknown",
        });
      });
    }
  }

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

    // Resting orders are checked on the prices just fetched — the warm-up
    // includes every symbol an open order names — so a limit fills within
    // seconds of the market reaching it, with nobody signed in. Before, that
    // waited for somebody to open the account.
    await matchAllRestingOrders(new Date()).catch((error: unknown) => {
      logger.error("orders.match.failure", {
        reason: error instanceof Error ? error.message : "unknown",
      });
    });

    const elapsed = Date.now() - started;
    const wait = EVERY_MS - (elapsed % EVERY_MS);
    if (elapsed + wait >= BUDGET_MS) break;
    await new Promise((resolve) => setTimeout(resolve, wait));
  }

  return Response.json({ awake: true, warmed: rounds > 0, rounds, symbols });
}

const SNAPSHOT_RETRY_MS = 10 * 60_000;

async function recordEveningSnapshots(
  db: Awaited<ReturnType<typeof getDb>>,
): Promise<"done" | "captured" | "waiting"> {
  const now = new Date();
  const today = marketDateString(now);
  const mark = await db.get<{ payload: string; fetched_at: string }>(
    `SELECT payload, fetched_at FROM series_cache WHERE key = 'cron:snapshot'`,
  );
  let state: { date?: string; complete?: boolean } = {};
  try {
    state = mark ? JSON.parse(mark.payload) : {};
  } catch {
    state = {};
  }
  if (state.date === today && state.complete) return "done";
  if (mark && Date.now() - Date.parse(mark.fetched_at) < SNAPSHOT_RETRY_MS) return "waiting";

  const { results } = await captureDailySnapshots(now);
  const complete = results.every(
    (row) => row.captured || row.reason === "Already recorded" || row.reason === "Not connected",
  );
  // A period is only measurable once its last close is in.
  if (complete) await awardCompletedPeriods(db, now);

  await db.run(
    `INSERT INTO series_cache (key, payload, fetched_at) VALUES ('cron:snapshot', ?, ?)
     ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at`,
    [JSON.stringify({ date: today, complete }), now.toISOString()],
  );
  return complete ? "captured" : "waiting";
}
