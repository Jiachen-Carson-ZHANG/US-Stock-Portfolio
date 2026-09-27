import type { BarInterval, HistoricalPrice } from "@/types/market";

export const CHART_RANGES = ["1D", "1W", "1M", "1Y", "MAX"] as const;
export type ChartRange = (typeof CHART_RANGES)[number];

/**
 * What each view of a price chart asks for.
 *
 * The range picks the candle: a day in five-minute candles, a week in
 * half-hours, a month in days, a year in weeks — daily candles for a year are
 * a pixel wide on a phone — and everything in months. Intraday
 * views ask for a few extra calendar days and keep only the last sessions, so
 * a weekend or a holiday still shows the last day that traded.
 */
const PLAN: Record<ChartRange, { interval: BarInterval; lookbackDays: number; sessions?: number }> = {
  "1D": { interval: "5m", lookbackDays: 7, sessions: 1 },
  "1W": { interval: "30m", lookbackDays: 10, sessions: 5 },
  "1M": { interval: "day", lookbackDays: 31 },
  "1Y": { interval: "week", lookbackDays: 366 },
  MAX: { interval: "month", lookbackDays: 365 * 30 },
};

export function chartWindow(
  range: ChartRange,
  now: Date,
): { from: string; to: string; interval: BarInterval; sessions?: number } {
  const plan = PLAN[range];
  const from = new Date(now.getTime() - plan.lookbackDays * 86_400_000);
  return {
    from: from.toISOString().slice(0, 10),
    to: now.toISOString().slice(0, 10),
    interval: plan.interval,
    sessions: plan.sessions,
  };
}

/** Only the bars of the last `sessions` trading days present. */
export function lastSessions(bars: HistoricalPrice[], sessions: number): HistoricalPrice[] {
  const days = [...new Set(bars.map((bar) => bar.date))].sort().slice(-sessions);
  const keep = new Set(days);
  return bars.filter((bar) => keep.has(bar.date));
}
