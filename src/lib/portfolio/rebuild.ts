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
  /**
   * What the broker values one unit of each holding at now — a share, or a
   * contract including its hundred. With these the check prices the replay's
   * holdings the way the broker prices the live ones, so it compares what is
   * held rather than which price was used.
   *
   * Without them an option was valued at its last trade on one side and at
   * the broker's mark on the other. For contracts that trade rarely those sit
   * hundreds of dollars apart — a Vertiv call last traded at 49.80 was marked
   * at 55.58 — and the owner's account was refused every rebuild although
   * nothing in it was wrong.
   */
  liveMarks?: Map<string, number>;
  tolerance?: number;
  /**
   * Only these days are written; the rest are worked out but left as they
   * are. For filling a gap without rewriting the evenings that were captured
   * live at the broker's own prices.
   */
  only?: Set<string> | null;
  write?: boolean;
  now?: Date;
  /**
   * A practice account's opening balance and the day it was made. It is the
   * account's first deposit in all but name — nothing records it as one — so
   * without it the rebuild found "no cash flows" and refused, and a practice
   * account's history could never be filled in.
   */
  opening?: { date: string; amount: number } | null;
}): Promise<RebuildReport> {
  const {
    db,
    portfolioId,
    loadPrices,
    liveValue = null,
    liveMarks = null,
    tolerance = 250,
    write = false,
    now = new Date(),
    opening = null,
    only = null,
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

  const recorded = (
    await db.all<{ date: string; amount: number }>(
      `SELECT date, amount FROM analysis_flows WHERE portfolio_id = ? ORDER BY date`,
      [portfolioId],
    )
  ).map((row): CashFlow => ({ date: row.date, amount: Number(row.amount) }));
  const flows =
    opening && opening.amount > 0 ? [{ date: opening.date, amount: opening.amount }, ...recorded] : recorded;

  // A practice account that has never traded is worth its cash every day:
  // no prices to fetch, nothing to replay.
  if (fills.length === 0 && opening && opening.amount > 0) {
    return untradedHistory({ db, portfolioId, flows, from: opening.date, now, write, only });
  }
  if (fills.length === 0) {
    return { ...empty, refusals: ["There are no trades on record to replay."] };
  }
  if (flows.length === 0) {
    return {
      ...empty,
      refusals: [
        "No deposits are recorded. Without their dates a deposit cannot be told apart from a gain — add them under Records.",
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
    return { ...empty, from, to, refusals: ["The broker sent no price history."] };
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

  // Like for like: the replay's holdings and cash, priced where the broker
  // prices the live ones. What is left is a difference in what is held — a
  // missing trade, a wrong contract size, a gift share — not in which price
  // was used for it.
  const replayed =
    last && liveMarks
      ? last.holdings.reduce((sum, holding) => {
          const mark = liveMarks.get(holding.symbol);
          const close = lastCloseOf(prices, holding.symbol);
          const unit = mark ?? (close === undefined ? 0 : close * multiplierFor(holding.symbol));
          return sum + holding.quantity * unit;
        }, last.cash.toNumber())
      : finalValue;
  const drift = liveValue !== null && replayed !== null ? Math.abs(replayed - liveValue) : 0;

  const refusals = [
    mismatched.length > 0 &&
      `${mismatched.length} trade(s) disagree with the cash the broker recorded for them.`,
    missing.length > 0 && `The broker has no price history for ${missing.join(", ")}.`,
    liveValue !== null &&
      drift > tolerance &&
      `Replaying the trades lands $${drift.toFixed(2)} away from what the broker shows now (more than $${tolerance}), so something is missing — a trade, a transfer or a dividend. Nothing was changed.`,
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
    if (only && !only.has(day.date)) continue;
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

/** The most recent close on record for a symbol, whatever its date. */
function lastCloseOf(prices: PriceSeries, symbol: string): number | undefined {
  const series = prices.get(symbol);
  if (!series || series.size === 0) return undefined;
  const latest = [...series.keys()].sort().pop()!;
  return series.get(latest);
}

/** Each weekday from `from` to yesterday, New York's calendar. */
function weekdaysFrom(from: string, now: Date): string[] {
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const days: string[] = [];
  const cursor = new Date(`${from}T16:00:00Z`);
  while (true) {
    const date = cursor.toISOString().slice(0, 10);
    if (date >= today) break;
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) days.push(date);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

/**
 * The history of an account that has only ever held cash: its opening
 * balance plus whatever was paid in, each weekday up to yesterday. Today is
 * left to the evening capture, which knows today's value for certain.
 */
async function untradedHistory(options: {
  db: DB;
  portfolioId: string;
  flows: CashFlow[];
  from: string;
  now: Date;
  write: boolean;
  only: Set<string> | null;
}): Promise<RebuildReport> {
  const { db, portfolioId, flows, from, now, write, only } = options;
  const dates = weekdaysFrom(from, now);
  const currency = process.env.PORTFOLIO_BASE_CURRENCY ?? "USD";
  const money = (value: number) => ({ amount: value.toFixed(2), currency });

  let written = 0;
  let finalValue: number | null = null;
  for (const date of dates) {
    const cash = flows.filter((flow) => flow.date <= date).reduce((sum, flow) => sum + flow.amount, 0);
    finalValue = cash;
    if (!write || (only && !only.has(date))) continue;
    await writeSnapshot(
      db,
      portfolioId,
      date,
      {
        totalMarketValue: money(cash),
        totalCostBasis: money(cash),
        totalUnrealizedPnL: money(0),
        cashValue: money(cash),
        realizedPnL: money(0),
        netDeposits: money(cash),
      },
      "[]",
      now,
      "reconstructed",
    );
    written += 1;
  }

  return {
    days: dates.length,
    written,
    from: dates[0] ?? null,
    to: dates[dates.length - 1] ?? null,
    refusals: [],
    finalValue,
  };
}
