import type { DB } from "@/lib/db";
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
  return Number(process.env.QUOTE_CACHE_SECONDS ?? 15);
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

function readCache(db: DB, symbols: string[]): Map<string, QuoteRow> {
  if (symbols.length === 0) return new Map();
  const placeholders = symbols.map(() => "?").join(",");
  const rows = db
    .prepare(`SELECT * FROM quote_cache WHERE symbol IN (${placeholders})`)
    .all(...symbols) as QuoteRow[];
  return new Map(rows.map((row) => [row.symbol, row]));
}

function writeCache(db: DB, quotes: Quote[], now: Date): void {
  const statement = db.prepare(
    `INSERT INTO quote_cache
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
       cached_at = excluded.cached_at`,
  );

  const writeAll = db.transaction((items: Quote[]) => {
    for (const quote of items) {
      statement.run(
        quote.symbol,
        quote.price,
        quote.previousClose,
        quote.change,
        quote.changePercent,
        quote.marketStatus,
        quote.dataTimestamp,
        quote.source,
        now.toISOString(),
      );
    }
  });

  writeAll(quotes);
}

/**
 * Serves quotes from the shared server-side cache, only calling the provider
 * for symbols whose cache entry has aged out (§15). A provider failure falls
 * back to stale cache rather than blanking the dashboard (§28).
 */
export async function getQuotes(
  db: DB,
  symbols: string[],
  provider: MarketDataProvider,
  now: Date = new Date(),
): Promise<QuoteResult> {
  const cached = readCache(db, symbols);
  const ttlMs = cacheTtlSeconds() * 1000;

  const expired = symbols.filter((symbol) => {
    const row = cached.get(symbol);
    if (!row) return true;
    return now.getTime() - new Date(row.cached_at).getTime() > ttlMs;
  });

  let isStale = false;

  if (expired.length > 0) {
    try {
      const fresh = await provider.getQuotes(expired);
      writeCache(db, fresh, now);
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
