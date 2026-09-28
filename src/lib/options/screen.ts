import "server-only";
import type { DB } from "@/lib/db";
import { yearsUntil } from "@/lib/analysis/options-pricing";
import type { MarketDataProvider } from "@/providers/market-data/types";
import type { OptionExpiration } from "@/types/market";
import { loadPricedChain } from "./chain-server";
import { candidates, rankAcross, type DatedCandidate, type ScreenSort, type StrategyKey } from "./strategies";

/** Expiries searched at most, however long the horizon. */
const MAX_EXPIRIES = 10;

/**
 * Every expiry within the horizon, searched and ranked together.
 *
 * Picking a date first and then reading down one list was the part people
 * had to do by eye. This prices each expiry's contracts near the share price
 * (or inside the strike range given), builds every candidate the goal allows,
 * and ranks them all on one scale, so the answer can come from any date.
 */
export async function screenAll(
  db: DB,
  provider: MarketDataProvider,
  input: {
    symbol: string;
    spot: number;
    expirations: OptionExpiration[];
    strategy: StrategyKey;
    horizonDays: number;
    minChance: number;
    sort: ScreenSort;
    min?: number;
    max?: number;
    now: Date;
  },
): Promise<{ candidates: DatedCandidate[]; expiries: number; contracts: number }> {
  const dates = input.expirations
    .filter((row) => row.days >= 1 && row.days <= input.horizonDays)
    .slice(0, MAX_EXPIRIES);

  const found: DatedCandidate[] = [];
  let contracts = 0;
  // A few at a time: each is one or two broker calls, and all at once would
  // be a burst the broker asks callers to avoid.
  for (let i = 0; i < dates.length; i += 3) {
    const batch = await Promise.all(
      dates.slice(i, i + 3).map(async (row) => {
        const { priced } = await loadPricedChain(db, provider, input.symbol, row.date, input.spot, input.now, {
          nearest: input.min !== undefined || input.max !== undefined ? 60 : 30,
          min: input.min,
          max: input.max,
        });
        contracts += priced.length;
        return candidates(input.strategy, priced, input.spot, yearsUntil(row.date, input.now), 400, 0).map(
          (candidate) => ({ ...candidate, expiry: row.date, days: row.days }),
        );
      }),
    );
    for (const list of batch) found.push(...list);
  }

  return {
    candidates: rankAcross(input.strategy, found, input.sort, input.minChance),
    expiries: dates.length,
    contracts,
  };
}
