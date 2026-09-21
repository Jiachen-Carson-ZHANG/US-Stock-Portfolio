import type { PortfolioSnapshot } from "@/types/portfolio";
import {
  annualisedVolatilityPercent,
  maxDrawdownPercent,
  type SeriesStats,
} from "./statistics";

export type CashFlow = {
  id?: string;
  date: string;
  amount: number;
  note?: string;
};
export type Coverage = { from: string; to: string };
export type Observation = { date: string; value: number };
export type AdjustedPoint = {
  date: string;
  value: number;
  index: number;
  intervalReturn: number | null;
};
export type Analysis = {
  points: AdjustedPoint[];
  issue: "review" | "history" | "flowGap" | "invalid" | null;
  daily: boolean;
  netFlows: number;
  gain: number | null;
};

// Conservative: missing weekdays (including holidays) suppress daily statistics.
// Period returns can still use the observed endpoints if there is no intervening flow.
function consecutiveWeekdays(from: string, to: string): boolean {
  const date = new Date(`${from}T12:00:00Z`);
  do {
    date.setUTCDate(date.getUTCDate() + 1);
  } while ([0, 6].includes(date.getUTCDay()));
  return (
    date.toISOString().slice(0, 10) === to &&
    ![0, 6].includes(new Date(`${from}T12:00:00Z`).getUTCDay())
  );
}

/** End-of-day flow convention; never assumes an unreviewed ledger is complete. */
export function adjustedSeries(
  snapshots: PortfolioSnapshot[],
  flows: CashFlow[],
  coverage: Coverage | null,
): Analysis {
  const empty = (issue: Analysis["issue"]): Analysis => ({
    points: [],
    issue,
    daily: false,
    netFlows: 0,
    gain: null,
  });
  if (snapshots.length < 2) return empty("history");
  const first = snapshots[0],
    last = snapshots[snapshots.length - 1];
  if (
    !coverage ||
    coverage.from > first.snapshotDate ||
    coverage.to < last.snapshotDate
  )
    return empty("review");
  const relevant = flows.filter(
    (f) => f.date > first.snapshotDate && f.date <= last.snapshotDate,
  );
  let index = 100,
    daily = true;
  const points: AdjustedPoint[] = [
    {
      date: first.snapshotDate,
      value: Number(first.totalMarketValue),
      index,
      intervalReturn: null,
    },
  ];
  if (!Number.isFinite(points[0].value) || points[0].value <= 0)
    return empty("invalid");
  for (let i = 1; i < snapshots.length; i++) {
    const prev = snapshots[i - 1],
      current = snapshots[i];
    if (current.snapshotDate <= prev.snapshotDate) return empty("invalid");
    const within = relevant.filter(
      (f) => f.date > prev.snapshotDate && f.date <= current.snapshotDate,
    );
    if (within.some((f) => f.date !== current.snapshotDate))
      return empty("flowGap");
    const flow = within.reduce((sum, f) => sum + f.amount, 0);
    const before = Number(prev.totalMarketValue),
      value = Number(current.totalMarketValue);
    if (
      before <= 0 ||
      !Number.isFinite(value) ||
      value < 0 ||
      !Number.isFinite(flow)
    )
      return empty("invalid");
    const intervalReturn = (value - flow) / before - 1;
    if (intervalReturn < -1) return empty("invalid");
    index *= 1 + intervalReturn;
    points.push({ date: current.snapshotDate, value, index, intervalReturn });
    daily &&= consecutiveWeekdays(prev.snapshotDate, current.snapshotDate);
  }
  const netFlows = relevant.reduce((sum, f) => sum + f.amount, 0);
  return {
    points,
    issue: null,
    daily,
    netFlows,
    gain:
      Number(last.totalMarketValue) - Number(first.totalMarketValue) - netFlows,
  };
}

export function analysisStats(result: Analysis): SeriesStats {
  const values = result.points.map((p) => p.index),
    returns = result.points.slice(1).map((p) => p.intervalReturn!);
  return {
    periodReturnPercent:
      values.length > 1 ? values[values.length - 1] - 100 : null,
    maxDrawdownPercent: maxDrawdownPercent(values),
    annualisedVolatilityPercent: result.daily
      ? annualisedVolatilityPercent(values)
      : null,
    bestDayPercent:
      result.daily && returns.length ? Math.max(...returns) * 100 : null,
    worstDayPercent:
      result.daily && returns.length ? Math.min(...returns) * 100 : null,
  };
}

/**
 * Per-month return, and the money behind it.
 *
 * The percentage is time-weighted, which is the fair way to compare months.
 * The amount is simply what the account gained after taking out anything
 * paid in — which is the number a person actually means by "how did
 * September go". Both are useful and they answer different questions, so
 * the calendar shows the percentage large and the amount beneath it.
 */
export function monthlyReturns(result: Analysis, flows: CashFlow[] = []) {
  const months = new Map<
    string,
    {
      month: string;
      factor: number;
      from: string;
      to: string;
      fromValue: number;
      toValue: number;
      observations: number;
    }
  >();
  for (let i = 1; i < result.points.length; i++) {
    const point = result.points[i],
      previous = result.points[i - 1];
    // Do not assign a multi-month interval to its final month.
    if (
      previous.date.slice(0, 7) !== point.date.slice(0, 7) &&
      !consecutiveWeekdays(previous.date, point.date)
    )
      continue;
    const month = point.date.slice(0, 7);
    const row = months.get(month) ?? {
      month,
      factor: 1,
      from: previous.date,
      to: point.date,
      fromValue: previous.value,
      toValue: point.value,
      observations: 0,
    };
    row.factor *= 1 + point.intervalReturn!;
    row.to = point.date;
    row.toValue = point.value;
    row.observations++;
    months.set(month, row);
  }
  return [...months.values()].map((row) => {
    // End-of-day convention, matching adjustedSeries: a flow dated on the
    // opening day landed after that day's close, so it belongs to this month.
    const within = flows
      .filter((flow) => flow.date >= row.from && flow.date <= row.to)
      .reduce((sum, flow) => sum + flow.amount, 0);
    return {
      ...row,
      percent: (row.factor - 1) * 100,
      amount: row.toValue - row.fromValue - within,
      flows: within,
    };
  });
}

export function benchmarkComparison(
  points: AdjustedPoint[],
  benchmark: Observation[],
) {
  const prices = new Map(benchmark.map((p) => [p.date, p.value]));
  const common = points.filter(
    (p) => prices.has(p.date) && prices.get(p.date)! > 0,
  );
  if (common.length < 2 || common[0].index <= 0) return [];
  const baseline = common[0];
  return common.map((p) => ({
    date: p.date,
    portfolio: (p.index / baseline.index) * 100,
    benchmark: (prices.get(p.date)! / prices.get(baseline.date)!) * 100,
  }));
}

/** Exact endpoint account-value decomposition. Includes cash flows, not a return. */
export function fxDecomposition(
  startUsd: number,
  endUsd: number,
  startFx: number,
  endFx: number,
) {
  const investment = (endUsd - startUsd) * startFx;
  const currency = endUsd * (endFx - startFx);
  return { investment, currency, total: endUsd * endFx - startUsd * startFx };
}

export type PayoffLeg = {
  type: "call" | "put";
  strike: number;
  premium: number;
  quantity: number;
  multiplier: number;
};
export function expirationPayoff(
  legs: PayoffLeg[],
  price: number,
  fees = 0,
): number {
  if (
    !Number.isFinite(price) ||
    price < 0 ||
    !Number.isFinite(fees) ||
    fees < 0
  )
    return NaN;
  return legs.reduce(
    (sum, leg) =>
      sum +
      (Math.max(
        0,
        leg.type === "call" ? price - leg.strike : leg.strike - price,
      ) -
        leg.premium) *
        leg.quantity *
        leg.multiplier,
    -fees,
  );
}
