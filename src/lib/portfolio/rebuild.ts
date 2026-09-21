import type { DB } from "@/lib/db";
import { parseSymbol } from "@/lib/moomoo/symbols";
import { reconstruct, type CashFlow, type PriceSeries } from "./reconstruct";
import { readTransactions } from "./transactions";
import { writeSnapshot } from "./snapshots";

export type RebuildReport = {
  days: number;
  written: number;
  from: string | null;
  to: string | null;
  refusals: string[];
  finalValue: number | null;
};

/** Where daily closes come from. Injected so the script can cache on disk. */
export type PriceLoader = (
  symbols: string[],
  range: { from: string; to: string },
) => Promise<{ prices: PriceSeries; missing: string[] }>;

function multiplierFor(symbol: string): number {
  return parseSymbol(symbol).instrumentType === "option" ? 100 : 1;
}

/**
 * Rebuilds a portfolio's daily history from its fills and cash flows.
 *
 * Shared by the command-line tool and the scheduled backstop so the two can
 * never drift. They differed once before — each had its own idea of what an
 * option symbol looks like, and both were wrong.
 *
 * A snapshot is a cache of a derivation, so re-deriving is always safe: a day
 * that was missed can be filled later, and a day already recorded is
 * corrected rather than duplicated.
 */
export async function rebuildHistory(options: {
  db: DB;
  portfolioId: string;
  loadPrices: PriceLoader;
  /** Value the account should land on, used as the sanity check. */
  liveValue?: number | null;
  tolerance?: number;
  write?: boolean;
  now?: Date;
}): Promise<RebuildReport> {
  const {
    db,
    portfolioId,
    loadPrices,
    liveValue = null,
    tolerance = 250,
    write = false,
    now = new Date(),
  } = options;

  const empty: RebuildReport = {
    days: 0,
    written: 0,
    from: null,
    to: null,
    refusals: [],
    finalValue: null,
  };

  const fills = (await readTransactions(db, portfolioId, 5000)).slice().reverse();
  if (fills.length === 0) {
    return { ...empty, refusals: ["No fills on record"] };
  }

  const flows = (
    await db.all<{ date: string; amount: number }>(
      `SELECT date, amount FROM analysis_flows WHERE portfolio_id = ? ORDER BY date`,
      [portfolioId],
    )
  ).map((row): CashFlow => ({ date: row.date, amount: Number(row.amount) }));
  if (flows.length === 0) {
    return {
      ...empty,
      refusals: [
        "No cash flows recorded — without dates a deposit cannot be told apart from a gain",
      ],
    };
  }

  // The broker's own figure for what each fill moved is the one number
  // independent of our contract-size rule, so it is what catches a wrong one.
  const mismatched = fills.filter((fill) => {
    const expected = fill.quantity * fill.price * multiplierFor(fill.symbol);
    const actual = Math.abs(fill.amount);
    if (!Number.isFinite(actual) || actual === 0) return false;
    return Math.abs(expected - actual) > Math.max(1, actual * 0.01);
  });

  const from = fills[0].tradedAt.slice(0, 10);
  const to = now.toISOString().slice(0, 10);
  const symbols = [...new Set(fills.map((f) => f.symbol))];
  const { prices, missing } = await loadPrices(symbols, { from, to });

  const tradingDays = new Set<string>();
  for (const series of prices.values()) {
    for (const date of series.keys()) tradingDays.add(date);
  }
  if (tradingDays.size === 0) {
    return { ...empty, from, to, refusals: ["No price history available"] };
  }

  // Every weekday, not only the days with a close: the daily statistics
  // refuse to run across a gap, and a market holiday is a gap. Carrying the
  // last close through a closed day is not an approximation — nothing traded.
  const cursor = new Date(`${[...tradingDays].sort()[0]}T00:00:00Z`);
  const stop = new Date(`${to}T00:00:00Z`);
  while (cursor <= stop) {
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) tradingDays.add(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const dates = [...tradingDays].sort();
  const days = reconstruct(fills, flows, prices, dates);
  const last = days[days.length - 1];
  const finalValue = last ? last.marketValue.toNumber() : null;

  const drift =
    liveValue !== null && finalValue !== null ? Math.abs(finalValue - liveValue) : 0;

  const refusals = [
    mismatched.length > 0 &&
      `${mismatched.length} fill(s) disagree with the cash the broker recorded`,
    missing.length > 0 && `${missing.length} symbol(s) have no price history: ${missing.join(", ")}`,
    liveValue !== null &&
      drift > tolerance &&
      `final value is ${drift.toFixed(2)} from the live account, over the ${tolerance} tolerance`,
  ].filter(Boolean) as string[];

  if (!write || refusals.length > 0) {
    return { days: days.length, written: 0, from, to, refusals, finalValue };
  }

  const usd = (value: { toFixed(dp: number): string }, currency: string) => ({
    amount: value.toFixed(2),
    currency,
  });
  const currency = process.env.PORTFOLIO_BASE_CURRENCY ?? "USD";

  let written = 0;
  for (const day of days) {
    await writeSnapshot(
      db,
      portfolioId,
      day.date,
      {
        totalMarketValue: usd(day.marketValue, currency),
        totalCostBasis: usd(day.costBasis.plus(day.cash), currency),
        totalUnrealizedPnL: usd(day.unrealized, currency),
        cashValue: usd(day.cash, currency),
        realizedPnL: usd(day.realized, currency),
        netDeposits: usd(day.netDeposits, currency),
      },
      "[]",
      now,
      "reconstructed",
    );
    written += 1;
  }

  return { days: days.length, written, from, to, refusals: [], finalValue };
}
