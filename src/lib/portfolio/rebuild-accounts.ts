import "server-only";
import { getDb, type DB } from "@/lib/db";
import { logger } from "@/lib/logger";
import { listPortfolios, type Portfolio } from "@/lib/portfolios";
import { rebuildHistory, type PriceLoader } from "@/lib/portfolio/rebuild";
import { getMarketDataProvider } from "@/providers";

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

export type RebuildResult = {
  slug: string;
  name: string;
  written: number;
  days: number;
  refusals: string[];
};

/**
 * The rebuild itself, with no opinion about who asked for it.
 *
 * Callers: the monthly scheduler above, which carries a shared secret; an
 * owner pressing a button in settings, which carries a session; and the
 * evening job filling in days that were missed. The work is identical and
 * lives here rather than being duplicated or, worse, having the button hold
 * a copy of the secret.
 */
export async function rebuildEveryPortfolio(): Promise<RebuildResult[]> {
  const db = await getDb();
  const results: RebuildResult[] = [];
  for (const portfolio of await listPortfolios(db)) {
    results.push(await rebuildPortfolio(db, portfolio));
  }
  return results;
}

/** One account's history, re-derived; `only` limits which days are written. */
export async function rebuildPortfolio(
  db: DB,
  portfolio: Portfolio,
  options: { only?: Set<string> | null } = {},
): Promise<RebuildResult> {
  // Like for like: the replay's value includes cash, so the comparison must,
  // and each holding is priced where the broker prices it now.
  const rows = await db.all<{
    symbol: string;
    instrument_type: string;
    quantity: string;
    reported_market_value: string | null;
  }>(
    `SELECT symbol, instrument_type, quantity::text AS quantity,
            reported_market_value::text AS reported_market_value
       FROM positions WHERE portfolio_id = ?`,
    [portfolio.id],
  );
  let liveValue = 0;
  const liveMarks = new Map<string, number>();
  for (const row of rows) {
    const quantity = Number(row.quantity);
    if (row.instrument_type === "cash") {
      liveValue += quantity;
      continue;
    }
    const value = Number(row.reported_market_value ?? 0);
    liveValue += value;
    if (quantity !== 0 && Number.isFinite(value)) liveMarks.set(row.symbol, value / quantity);
  }

  const report = await rebuildHistory({
    db,
    portfolioId: portfolio.id,
    loadPrices: loaderFor(portfolio.id),
    liveValue: liveValue > 0 ? liveValue : null,
    liveMarks,
    write: true,
    only: options.only ?? null,
    // A practice account starts from its opening balance on the day it was
    // made; that is its first deposit.
    opening:
      portfolio.kind === "mock"
        ? {
            date: new Intl.DateTimeFormat("en-CA", {
              timeZone: "America/New_York",
              year: "numeric",
              month: "2-digit",
              day: "2-digit",
            }).format(new Date(portfolio.createdAt)),
            amount: Number(portfolio.openingCash ?? 0),
          }
        : null,
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

  return {
    slug: portfolio.slug,
    name: portfolio.displayName,
    written: report.written,
    days: report.days,
    refusals: report.refusals,
  };
}
