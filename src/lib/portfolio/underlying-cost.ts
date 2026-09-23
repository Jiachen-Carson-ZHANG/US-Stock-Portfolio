import "server-only";
import type { DB } from "@/lib/db";
import type { MarketDataProvider } from "@/providers/market-data/types";
import { cachedSeries, DAILY_TTL_MS } from "@/lib/analysis/series-cache";
import type { OptionGroup } from "./options";

/**
 * What the share cost when the option was bought.
 *
 * An option's current price means little without knowing where the share was
 * when the bet was placed. "NBIS is 236 now" and "NBIS was 198 when you
 * bought a 200 strike" together say the whole thing: you were betting on a
 * move that has since happened.
 *
 * The broker does not record this — it records the option's price, not the
 * share's — so it is reconstructed: the dates the legs were actually bought,
 * and the share's close on each of those days, weighted by how many contracts
 * were bought that day.
 *
 * Closes are daily and cached for the day, so this costs one broker call per
 * underlying per day however many people look at the page.
 */
export async function underlyingCostPrices(
  db: DB,
  portfolioId: string,
  groups: OptionGroup[],
  provider: MarketDataProvider,
): Promise<Record<string, number>> {
  if (groups.length === 0) return {};

  const legSymbols = groups.flatMap((group) => group.legs.map((leg) => leg.symbol));
  if (legSymbols.length === 0) return {};

  const fills = await db.all<{ symbol: string; quantity: number; traded_at: string }>(
    `SELECT symbol, quantity, traded_at
       FROM transactions
      WHERE portfolio_id = ? AND symbol = ANY(?) AND side = 'buy'`,
    [portfolioId, legSymbols],
  );
  if (fills.length === 0) return {};

  // Which underlying each leg belongs to, so a fill can be attributed without
  // parsing the contract symbol a second time.
  const underlyingOf = new Map<string, string>();
  for (const group of groups) {
    for (const leg of group.legs) underlyingOf.set(leg.symbol, group.underlying);
  }

  // Bought on which days, and how heavily, per underlying.
  const weightsBy = new Map<string, Map<string, number>>();
  for (const fill of fills) {
    const underlying = underlyingOf.get(fill.symbol);
    if (!underlying) continue;
    const date = fill.traded_at.slice(0, 10);
    const weight = Math.abs(Number(fill.quantity));
    if (!Number.isFinite(weight) || weight === 0) continue;

    const byDate = weightsBy.get(underlying) ?? new Map<string, number>();
    byDate.set(date, (byDate.get(date) ?? 0) + weight);
    weightsBy.set(underlying, byDate);
  }

  const result: Record<string, number> = {};

  await Promise.all(
    [...weightsBy].map(async ([underlying, byDate]) => {
      const dates = [...byDate.keys()].sort();
      const from = dates[0];
      const to = dates[dates.length - 1];

      try {
        const closes = await cachedSeries(
          `underlying:${underlying}:${from}:${to}`,
          DAILY_TTL_MS,
          async () => {
            const history = await provider.getHistoricalPrices(underlying, { from, to });
            return Object.fromEntries(history.map((row) => [row.date, row.close]));
          },
        );

        let weighted = 0;
        let total = 0;
        for (const [date, weight] of byDate) {
          // A trade on a day the feed has no close for — a holiday, or a
          // range the provider trimmed — is skipped rather than priced at
          // zero, which would drag the average towards nothing.
          const close = closes[date];
          if (!Number.isFinite(close) || close <= 0) continue;
          weighted += close * weight;
          total += weight;
        }

        if (total > 0) result[underlying] = weighted / total;
      } catch {
        // No history, no figure. The card simply does not show one.
      }
    }),
  );

  return result;
}
