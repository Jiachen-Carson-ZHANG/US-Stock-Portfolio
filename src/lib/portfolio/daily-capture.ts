import "server-only";
import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";
import { isAfterMarketClose, marketDateString } from "@/lib/market-hours";
import { listPortfolios } from "@/lib/portfolios";
import { getBrokerProvider, hasBrokerConnection } from "@/providers";
import { loadPortfolio } from "./service";
import { hasSnapshot } from "./snapshots";
import { syncPositions } from "./sync";
import { warmQuotes } from "./warm-quotes";

export type CaptureResult = { slug: string; captured: boolean; reason?: string };

/**
 * Records today's closing value for every account, once the market has shut.
 *
 * A snapshot used to be taken only when somebody happened to open an account
 * between 4pm and midnight New York time — 4am to noon in Singapore, where
 * nobody here is looking — and the scheduled job meant to cover the rest was
 * never set up. So nothing had been recorded since the 21st, and the
 * practice accounts had never been recorded at all: the performance chart
 * stopped, and the arena had nothing to rank.
 *
 * The minute scheduler that already keeps prices fresh now calls this after
 * the close. It first makes what a snapshot insists on true — prices fetched
 * this evening, and broker holdings pulled since the close — and then loads
 * each account, which is what records it. An account already recorded today
 * is skipped, so calling this again only finishes what is left.
 */
export async function captureDailySnapshots(now: Date = new Date()): Promise<{
  date: string | null;
  results: CaptureResult[];
}> {
  if (!isAfterMarketClose(now)) return { date: null, results: [] };
  const date = marketDateString(now);
  const db = await getDb();

  const portfolios = await listPortfolios(db);
  const pending = [];
  for (const portfolio of portfolios) {
    if (!(await hasSnapshot(db, portfolio.id, date))) pending.push(portfolio);
  }
  if (pending.length === 0) {
    return {
      date,
      results: portfolios.map((p) => ({ slug: p.slug, captured: false, reason: "Already recorded" })),
    };
  }

  await warmQuotes(now, { force: true }).catch((error: unknown) => {
    logger.error("snapshot.capture.warm_failed", {
      reason: error instanceof Error ? error.message : "unknown",
    });
  });

  const results: CaptureResult[] = [];
  for (const portfolio of pending) {
    try {
      // A snapshot of a broker account needs holdings pulled after the
      // close; waiting for the page-load sync would record nothing.
      if (portfolio.kind === "broker") {
        if (!(await hasBrokerConnection(portfolio.id))) {
          results.push({ slug: portfolio.slug, captured: false, reason: "Not connected" });
          continue;
        }
        await syncPositions(db, portfolio.id, await getBrokerProvider(portfolio.id), "moomoo", now);
      }
      await loadPortfolio(portfolio.id, now);
      const captured = await hasSnapshot(db, portfolio.id, date);
      results.push({
        slug: portfolio.slug,
        captured,
        ...(captured ? {} : { reason: "Prices not fresh enough yet; will retry" }),
      });
    } catch (error) {
      logger.error("snapshot.capture.failed", {
        portfolio: portfolio.slug,
        reason: error instanceof Error ? error.message : "unknown",
      });
      results.push({ slug: portfolio.slug, captured: false, reason: "Capture failed" });
    }
  }

  logger.info("snapshot.capture.done", {
    date,
    captured: results.filter((r) => r.captured).length,
    pending: pending.length,
  });
  return { date, results };
}
