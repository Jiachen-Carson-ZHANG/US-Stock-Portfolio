import { createHash, timingSafeEqual } from "node:crypto";
import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";
import { listPortfolios } from "@/lib/portfolios";
import { rebuildHistory, type PriceLoader } from "@/lib/portfolio/rebuild";
import { getMarketDataProvider } from "@/providers";

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
export const maxDuration = 300;

function loaderFor(portfolioId: string): PriceLoader {
  return async (symbols, range) => {
    const provider = await getMarketDataProvider(portfolioId);
    const prices = new Map<string, Map<string, number>>();
    const missing: string[] = [];

    for (const symbol of symbols) {
      try {
        const history = await provider.getHistoricalPrices(symbol, range);
        if (history.length === 0) {
          missing.push(symbol);
          continue;
        }
        prices.set(symbol, new Map(history.map((p) => [p.date, p.close])));
      } catch {
        missing.push(symbol);
      }
      // The broker rate-limits, and a throttled response comes back empty
      // rather than as an error. Pacing the requests is what keeps a rebuild
      // from quietly pricing half the account at nothing.
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    return { prices, missing };
  };
}

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

/**
 * The rebuild itself, with no opinion about who asked for it.
 *
 * Two callers: the monthly scheduler above, which carries a shared secret,
 * and an owner pressing a button in settings, which carries a session. The
 * work is identical and lives here rather than being duplicated or, worse,
 * having the button hold a copy of the secret.
 */
export async function rebuildEveryPortfolio(): Promise<
  { slug: string; written: number; days: number; refusals: string[] }[]
> {
  const db = await getDb();
  const results: {
    slug: string;
    written: number;
    days: number;
    refusals: string[];
  }[] = [];

  for (const portfolio of await listPortfolios(db)) {
    // Like for like: the replay's value includes cash, so the comparison must.
    const live = await db.get<{ positions: string; cash: string }>(
      `SELECT COALESCE(SUM(CASE WHEN instrument_type <> 'cash'
                                THEN COALESCE(reported_market_value, 0) ELSE 0 END), 0)::text AS positions,
              COALESCE(SUM(CASE WHEN instrument_type = 'cash'
                                THEN quantity ELSE 0 END), 0)::text AS cash
         FROM positions WHERE portfolio_id = ?`,
      [portfolio.id],
    );
    const liveValue = live
      ? Number(live.positions) + Number(live.cash)
      : null;

    const report = await rebuildHistory({
      db,
      portfolioId: portfolio.id,
      loadPrices: loaderFor(portfolio.id),
      liveValue: liveValue && liveValue > 0 ? liveValue : null,
      write: true,
    });

    if (report.refusals.length > 0) {
      logger.warn("portfolio.rebuild.refused", {
        portfolio: portfolio.slug,
        reason: report.refusals.join("; "),
      });
    } else {
      logger.info("portfolio.rebuild.done", {
        portfolio: portfolio.slug,
        written: report.written,
      });
    }

    results.push({
      slug: portfolio.slug,
      written: report.written,
      days: report.days,
      refusals: report.refusals,
    });
  }

  return results;
}
