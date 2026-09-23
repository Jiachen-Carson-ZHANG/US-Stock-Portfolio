// Pure on purpose. The chart re-runs the comparison in the browser whenever
// the date range changes, so nothing here may touch the network or the
// database — fetching lives in benchmarks-server.ts.
import type { AdjustedPoint } from "./math";

/**
 * What the account gets measured against.
 *
 * Three real, tradable funds rather than an index nobody can buy, because
 * "you would have had this instead" only means something if you could
 * actually have had it. VOO is the S&P 500, QQQ is the Nasdaq-100, and ONEQ
 * is the whole Nasdaq Composite — which is what people mean by "the Nasdaq"
 * and is a different thing from QQQ's largest hundred.
 */
export const BENCHMARKS = [
  { key: "VOO", label: "S&P 500 · VOO" },
  { key: "QQQ", label: "Nasdaq-100 · QQQ" },
  { key: "ONEQ", label: "Nasdaq Composite · ONEQ" },
] as const;

export type BenchmarkKey = (typeof BENCHMARKS)[number]["key"];

/** The equal-weight mix of the three, a third in each. */
export const BLEND = { key: "BLEND", label: "Equal mix · a third in each" } as const;

export type BenchmarkSeries = {
  key: string;
  label: string;
  /** Close by date, already filtered to trading days the feed returned. */
  points: { date: string; value: number }[];
};

/**
 * A third in each, rebalanced daily.
 *
 * Averaging the three indexed curves is exactly a daily-rebalanced equal
 * mix, which is the honest reading of "a third in each" — and it needs only
 * the dates all three actually share, so a fund with a missing day cannot
 * quietly drag the mix down.
 */
export function equalMix(series: BenchmarkSeries[]): BenchmarkSeries | null {
  if (series.length < 2) return null;

  const shared = series
    .map((s) => new Set(s.points.map((p) => p.date)))
    .reduce((all, dates) => new Set([...all].filter((date) => dates.has(date))));
  const dates = [...shared].sort();
  if (dates.length < 2) return null;

  const base = series.map((s) => {
    const byDate = new Map(s.points.map((p) => [p.date, p.value]));
    return { byDate, first: byDate.get(dates[0])! };
  });

  return {
    key: BLEND.key,
    label: BLEND.label,
    points: dates.map((date) => ({
      date,
      value:
        base.reduce((total, s) => total + s.byDate.get(date)! / s.first, 0) / base.length,
    })),
  };
}

export type ComparisonRow = { date: string; portfolio: number } & Record<string, number>;

/**
 * Everything on one scale, starting at 100 on the first day they all share.
 *
 * Only dates the portfolio itself has a valuation for are used. Comparing a
 * day the account was not measured against a day the market was open would
 * put a step in one line that never happened.
 */
export function compareAll(
  points: AdjustedPoint[],
  series: BenchmarkSeries[],
): { rows: ComparisonRow[]; used: BenchmarkSeries[] } {
  if (points.length < 2 || series.length === 0) return { rows: [], used: [] };

  const maps = series.map((s) => ({ ...s, byDate: new Map(s.points.map((p) => [p.date, p.value])) }));
  const common = points.filter(
    (point) => point.index > 0 && maps.every((s) => (s.byDate.get(point.date) ?? 0) > 0),
  );
  if (common.length < 2) return { rows: [], used: [] };

  const first = common[0];
  const rows = common.map((point) => {
    const row: ComparisonRow = {
      date: point.date,
      portfolio: (point.index / first.index) * 100,
    } as ComparisonRow;
    for (const s of maps) {
      row[s.key] = (s.byDate.get(point.date)! / s.byDate.get(first.date)!) * 100;
    }
    return row;
  });

  return { rows, used: series };
}
