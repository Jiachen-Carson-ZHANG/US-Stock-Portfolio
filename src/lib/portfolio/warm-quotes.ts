import "server-only";
import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";
import { observe } from "@/lib/observe";
import { listPortfolios } from "@/lib/portfolios";
import { getMarketDataProvider } from "@/providers";
import { marketSession } from "@/lib/market-hours";
import { getQuotes } from "./quotes";
import { parseSymbol } from "@/lib/moomoo/symbols";

/**
 * Keeps the price cache warm with nobody signed in.
 *
 * Prices used to be fetched by whoever happened to open a page, which meant
 * the first visitor after a quiet hour paid for everybody's refresh — and, if
 * the broker was slow that minute, waited for it. Fetching on a schedule
 * instead means every page load reads a cache that is already current, and a
 * broker that is having a bad minute delays a background job rather than a
 * person.
 *
 * One request for the whole site, not one per portfolio. Every account holds
 * some of the same names, and a price is a price: the symbols are collected
 * across every portfolio, deduplicated, and asked for once. Ten accounts
 * holding NVDA cost one NVDA quote.
 *
 * Holdings are deliberately not refreshed here. What somebody owns changes
 * when they trade, is private to them, and is picked up when they open their
 * own page — pulling every account's positions on a timer would spend the
 * broker's rate limit on data nobody is looking at.
 */
export async function warmQuotes(now: Date = new Date()): Promise<{
  warmed: boolean;
  symbols: number;
  reason?: string;
}> {
  const session = marketSession(now);
  if (session === "closed") {
    return { warmed: false, symbols: 0, reason: "Market closed" };
  }

  const db = await getDb();
  const portfolios = await listPortfolios(db);
  if (portfolios.length === 0) return { warmed: false, symbols: 0, reason: "Nothing held" };

  // Everything anybody holds, plus the underlying of every option, plus every
  // symbol with an order resting on it — the union across all accounts.
  // Watched names too: a watchlist is only worth opening if its prices are
  // current, and it should not have to fetch them itself on every visit.
  const rows = await db.all<{ symbol: string; underlying_symbol: string | null }>(
    `SELECT DISTINCT symbol, underlying_symbol FROM positions
      WHERE instrument_type <> 'cash'
     UNION
     SELECT DISTINCT symbol, NULL FROM orders WHERE status = 'open'
     UNION
     SELECT DISTINCT symbol, NULL FROM watch_items`,
  );

  const symbols = [
    ...new Set(
      rows.flatMap((row) =>
        [row.symbol, row.underlying_symbol].filter(
          (value): value is string => typeof value === "string" && value.length > 0,
        ),
      ),
    ),
  ].filter((symbol) => parseSymbol(symbol).instrumentType !== "cash");

  if (symbols.length === 0) return { warmed: false, symbols: 0, reason: "Nothing held" };

  // Whichever connection can actually pay for the quotes. A price is public,
  // so it does not matter whose it is.
  const provider = await getMarketDataProvider(portfolios[0].id);

  await observe("quotes.warm", null, async () => {
    // Waits for the broker, unlike a page load. A background job that serves
    // the cache and refreshes "later" never refreshes at all on this host.
    await getQuotes(db, symbols, provider, now, { waitForFresh: true });
  });

  logger.info("quotes.warmed", { symbols: symbols.length, session });
  return { warmed: true, symbols: symbols.length };
}
