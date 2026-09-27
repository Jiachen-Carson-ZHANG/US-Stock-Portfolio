import "server-only";
import type { DB } from "@/lib/db";
import { cachedSeries } from "@/lib/analysis/series-cache";
import { getQuotes } from "@/lib/portfolio/quotes";
import { marketDateString } from "@/lib/market-hours";
import type { MarketDataProvider } from "@/providers/market-data/types";
import type { OptionContract, OptionExpiration } from "@/types/market";
import type { ChainQuote } from "./strategies";

/** One contract, priced: what the chain view and the finder both work from. */
export type PricedContract = ChainQuote & { last?: number; expiry: string };

export class NoOptionsError extends Error {}

function positive(value: unknown): number | undefined {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * The share's price and the expiries listed for it.
 *
 * Expiries change slowly, so they are kept for hours; the price goes through
 * the ordinary quote cache. The cache hands back what it has while it
 * refreshes, which after a quiet weekend is a list with Friday still on it and
 * every "days left" two out, so the list is brought up to today on the way out.
 */
export async function loadExpirations(
  db: DB,
  provider: MarketDataProvider,
  symbol: string,
  now: Date,
): Promise<{ spot: number | null; expirations: OptionExpiration[] }> {
  if (!provider.getOptionExpirations) throw new NoOptionsError("Option chains need a broker connection.");
  const listExpirations = provider.getOptionExpirations.bind(provider);
  const { quotes } = await getQuotes(db, [symbol], provider, now);
  const spot = quotes.get(symbol)?.price ?? null;
  if (spot === null) return { spot, expirations: [] };
  const expirations = await cachedSeries<OptionExpiration[]>(
    `options:expirations:${symbol}`,
    6 * 3_600_000,
    () => listExpirations(symbol),
  );
  const today = marketDateString(now);
  return {
    spot,
    expirations: expirations
      .filter((row) => row.date >= today)
      .map((row) => ({ ...row, days: Math.round((Date.parse(row.date) - Date.parse(today)) / 86_400_000) })),
  };
}

/**
 * The contracts on one expiry, priced.
 *
 * Which contracts are priced is the caller's choice: the ones nearest the
 * share price, or those inside a strike range somebody typed. Pricing a strike
 * half the share price away costs the same as pricing a useful one, so the
 * count is capped either way. Sales are priced at the bid and purchases at the
 * ask downstream; the last trade is kept only to show.
 */
export async function loadPricedChain(
  db: DB,
  provider: MarketDataProvider,
  symbol: string,
  expiry: string,
  spot: number,
  now: Date,
  options: { nearest?: number; min?: number; max?: number } = {},
): Promise<{ contracts: number; priced: PricedContract[] }> {
  if (!provider.getOptionChain) throw new NoOptionsError("Option chains need a broker connection.");
  const listChain = provider.getOptionChain.bind(provider);
  const chain = await cachedSeries<OptionContract[]>(
    `options:chain:${symbol}:${expiry}`,
    3_600_000,
    () => listChain(symbol, expiry),
  );

  const inRange = chain.filter(
    (contract) =>
      (options.min === undefined || contract.strike >= options.min) &&
      (options.max === undefined || contract.strike <= options.max),
  );
  // Strikes nearest the share price first; both the call and the put at each.
  const strikes = [...new Set(inRange.map((contract) => contract.strike))]
    .sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot))
    .slice(0, Math.min(options.nearest ?? 40, 150));
  const wanted = new Set(strikes);
  const chosen = inRange.filter((contract) => wanted.has(contract.strike));

  const { quotes } = await getQuotes(
    db,
    chosen.map((contract) => contract.symbol),
    provider,
    now,
    { waitForFresh: true },
  );

  const priced: PricedContract[] = chosen.flatMap((contract) => {
    const quote = quotes.get(contract.symbol);
    if (!quote) return [];
    const raw = quote.raw ?? {};
    return [
      {
        symbol: contract.symbol,
        type: contract.type,
        strike: contract.strike,
        expiry: contract.expiry,
        bid: positive(raw.bid_price),
        ask: positive(raw.ask_price),
        last: positive(quote.price),
        iv: quote.greeks?.impliedVolatility,
        delta: quote.greeks?.delta,
        openInterest: quote.greeks?.openInterest,
        volume: positive(raw.volume),
        multiplier: contract.multiplier,
      },
    ];
  });

  return { contracts: chain.length, priced };
}
