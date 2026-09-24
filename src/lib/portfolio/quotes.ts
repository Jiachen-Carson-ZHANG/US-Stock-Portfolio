import type { DB } from "@/lib/db";
import { dedupe } from "@/lib/inflight";
import { logger } from "@/lib/logger";
import { recordFailure } from "@/lib/observe";
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
  greeks: string | null;
  cached_at: string;
};

export type QuoteResult = {
  quotes: Map<string, Quote>;
  /** True when at least one quote came from cache older than its TTL. */
  isStale: boolean;
  /**
   * When these prices were last fetched — not when the instruments last
   * traded.
   *
   * This used to be the oldest `data_timestamp` across every symbol held, and
   * an option that had not traded for days dragged it back with it. The
   * dashboard then announced "session of 18 Sep" while the market was open on
   * the 22nd, and, worse, the daily snapshot refused to record because the
   * timestamp it was handed was not from today — so the performance history
   * quietly stopped growing. A price that is old because nobody traded it is
   * not the same thing as data we failed to refresh; `isStale` says the
   * second, and this says the first.
   */
  dataTimestamp: string | null;
};

/**
 * How old a cached price may be before it is worth asking again.
 *
 * Matched to the scheduler, which refreshes every ten seconds during the
 * session. Shorter than that and a page load would fetch a price the warmer
 * was about to fetch anyway.
 */
function cacheTtlSeconds(): number {
  return Number(process.env.QUOTE_CACHE_SECONDS ?? 10);
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
    greeks: parseGreeks(row.greeks),
  };
}

/**
 * A stored greeks blob, or nothing.
 *
 * Bad JSON in one row must not blank the whole quote — the price is the part
 * that matters, and an option without its delta is still tradable.
 */
function parseGreeks(raw: string | null): Quote["greeks"] {
  if (!raw) return undefined;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Quote["greeks"]) : undefined;
  } catch {
    return undefined;
  }
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
        market_status, data_timestamp, source, greeks, cached_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(symbol) DO UPDATE SET
       price = excluded.price,
       previous_close = excluded.previous_close,
       change = excluded.change,
       change_percent = excluded.change_percent,
       market_status = excluded.market_status,
       data_timestamp = excluded.data_timestamp,
       source = excluded.source,
       greeks = excluded.greeks,
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
        quote.greeks ? JSON.stringify(quote.greeks) : null,
        now.toISOString(),
      ]);
    }
  });
}

/**
 * How old a served-from-cache price may be before the page says so.
 *
 * Not a rule about whether to serve it — a cached price is always served
 * rather than making somebody wait — only about whether to admit it is old.
 */
const CALL_IT_STALE_MS = 60_000;

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

  // Anything at all in the cache is worth showing while a refresh runs.
  //
  // This used to insist the cached rows were under a minute old, which meant
  // that after a quiet hour the next person to open a page waited for the
  // broker — and if the broker was rate-limiting or simply not answering,
  // waited until it gave up. A price from an hour ago clearly labelled as
  // such is better than a page that will not load, every time. The only case
  // that still waits is having nothing whatsoever to show.
  const servableNow =
    expired.length > 0 && expired.every((symbol) => cached.has(symbol));

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
          greeks: quote.greeks ? JSON.stringify(quote.greeks) : null,
          cached_at: now.toISOString(),
        });
      }
    } catch (error) {
      isStale = cached.size > 0;
      // Handled, so nothing upstream throws and nothing upstream would record
      // it — which is how "live data temporarily unavailable" appeared on
      // screen with no trace anywhere of why. It leaves a trace now.
      const reason = error instanceof Error ? error.message : "unknown";
      logger.warn("quotes.fetch_failed", { symbols: expired.length, reason });
      void recordFailure("quotes.fetch", reason).catch(() => {});
    }
  }

  const quotes = new Map<string, Quote>();
  let fetchedAt: string | null = null;
  let oldest: number | null = null;

  for (const symbol of symbols) {
    const row = cached.get(symbol);
    if (!row) continue;
    quotes.set(symbol, toQuote(row));
    if (!fetchedAt || row.cached_at > fetchedAt) fetchedAt = row.cached_at;
    const age = now.getTime() - new Date(row.cached_at).getTime();
    if (Number.isFinite(age) && (oldest === null || age > oldest)) oldest = age;
  }

  // Stale means "what you are looking at is older than it should be", whether
  // that is because a fetch failed or because one is still on its way back.
  return {
    quotes,
    isStale: isStale || (oldest !== null && oldest > CALL_IT_STALE_MS),
    dataTimestamp: fetchedAt,
  };
}
