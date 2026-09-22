import type { DB } from "@/lib/db";
import { dedupe } from "@/lib/inflight";
import type { Quote } from "@/types/market";
import type { MarketDataProvider } from "@/providers/market-data/types";

type QuoteRow = {
  symbol: string;
  price: number;
  previous_close: number;
  change: number;
  change_percent: number;
  market_status: string;
  data_timestamp: string;
  source: string;
  cached_at: string;
};

export type QuoteResult = {
  quotes: Map<string, Quote>;
  /** True when at least one quote came from cache older than its TTL. */
  isStale: boolean;
  dataTimestamp: string | null;
};

function cacheTtlSeconds(): number {
  return Number(process.env.QUOTE_CACHE_SECONDS ?? 5);
}

function toQuote(row: QuoteRow): Quote {
  return {
    symbol: row.symbol,
    price: row.price,
    previousClose: row.previous_close,
    change: row.change,
    changePercent: row.change_percent,
    marketStatus: row.market_status as Quote["marketStatus"],
    dataTimestamp: row.data_timestamp,
    source: row.source,
  };
}

async function readCache(db: DB, symbols: string[]): Promise<Map<string, QuoteRow>> {
  if (symbols.length === 0) return new Map();
  // `= ANY($1)` takes the whole list as one array parameter, so the statement
  // text stays constant however many symbols are held — Postgres can then reuse
  // its plan instead of seeing a new query for each portfolio size.
  const rows = await db.all<QuoteRow>(
    `SELECT * FROM quote_cache WHERE symbol = ANY(?)`,
    [symbols],
  );
  return new Map(rows.map((row) => [row.symbol, row]));
}

async function writeCache(db: DB, quotes: Quote[], now: Date): Promise<void> {
  const sql = `INSERT INTO quote_cache
       (symbol, price, previous_close, change, change_percent,
        market_status, data_timestamp, source, cached_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(symbol) DO UPDATE SET
       price = excluded.price,
       previous_close = excluded.previous_close,
       change = excluded.change,
       change_percent = excluded.change_percent,
       market_status = excluded.market_status,
       data_timestamp = excluded.data_timestamp,
       source = excluded.source,
       cached_at = excluded.cached_at`;

  await db.transaction(async (tx) => {
    for (const quote of quotes) {
      await tx.run(sql, [
        quote.symbol,
        quote.price,
        quote.previousClose,
        quote.change,
        quote.changePercent,
        quote.marketStatus,
        quote.dataTimestamp,
        quote.source,
        now.toISOString(),
      ]);
    }
  });
}

/**
 * How far past its TTL a quote may be and still be served immediately while a
 * refresh runs behind the caller.
 *
 * Blocking a page render on a broker round trip is what made the site feel
 * slow: every five seconds one unlucky request paid for everybody's refresh.
 * Inside this window the caller gets the cached price now and the next one
 * gets the new price — which for a number that moves in cents over seconds is
 * a better trade than a spinner.
 *
 * Past it the quote is too old to show without asking, so the caller waits.
 */
const STALE_WHILE_REVALIDATE_MS = 60_000;

/**
 * Serves quotes from the shared server-side cache, only calling the provider
 * for symbols whose cache entry has aged out (§15). A provider failure falls
 * back to stale cache rather than blanking the dashboard (§28).
 *
 * Concurrent callers wanting the same symbols share one fetch, and a
 * moderately stale entry is served at once while that fetch happens.
 */
export async function getQuotes(
  db: DB,
  symbols: string[],
  provider: MarketDataProvider,
  now: Date = new Date(),
): Promise<QuoteResult> {
  const cached = await readCache(db, symbols);
  const ttlMs = cacheTtlSeconds() * 1000;

  const expired = symbols.filter((symbol) => {
    const row = cached.get(symbol);
    if (!row) return true;
    return now.getTime() - new Date(row.cached_at).getTime() > ttlMs;
  });

  // Old enough to want refreshing, but new enough to show meanwhile.
  const servableNow =
    expired.length > 0 &&
    expired.every((symbol) => {
      const row = cached.get(symbol);
      if (!row) return false;
      return now.getTime() - new Date(row.cached_at).getTime() <= STALE_WHILE_REVALIDATE_MS;
    });

  let isStale = false;

  if (expired.length > 0 && servableNow) {
    // Fire and forget, deduplicated: the page renders from cache and the next
    // request sees the new prices. A failure here is invisible by design —
    // the following call will simply try again.
    void dedupe(`quotes:${[...expired].sort().join(",")}`, async () => {
      const fresh = await provider.getQuotes(expired);
      await writeCache(db, fresh, new Date());
      return fresh;
    }).catch(() => {});
  } else if (expired.length > 0) {
    try {
      const fresh = await dedupe(
        `quotes:${[...expired].sort().join(",")}`,
        () => provider.getQuotes(expired),
      );
      await writeCache(db, fresh, now);
      for (const quote of fresh) {
        cached.set(quote.symbol, {
          symbol: quote.symbol,
          price: quote.price,
          previous_close: quote.previousClose,
          change: quote.change,
          change_percent: quote.changePercent,
          market_status: quote.marketStatus,
          data_timestamp: quote.dataTimestamp,
          source: quote.source,
          cached_at: now.toISOString(),
        });
      }
    } catch {
      isStale = cached.size > 0;
    }
  }

  const quotes = new Map<string, Quote>();
  let oldest: string | null = null;

  for (const symbol of symbols) {
    const row = cached.get(symbol);
    if (!row) continue;
    quotes.set(symbol, toQuote(row));
    if (!oldest || row.data_timestamp < oldest) oldest = row.data_timestamp;
  }

  return { quotes, isStale, dataTimestamp: oldest };
}
