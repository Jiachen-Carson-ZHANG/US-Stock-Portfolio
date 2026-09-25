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

/**
 * Weekdays inside the window that have no recorded value.
 *
 * A time-weighted index chains the moves between the days it has. Miss a run
 * of days and the chain still joins up, but each remaining link carries more
 * than one day's movement — so a chart drawn from a patchy history looks
 * jumpier than the account ever was, and a single missing week around a fall
 * can make the dip look far deeper than it was.
 *
 * Holidays are not modelled, so a market holiday counts as missing. That
 * over-reports slightly, which is the right direction for a warning.
 */
export function missingWeekdays(dates: string[]): number {
  if (dates.length < 2) return 0;

  const have = new Set(dates);
  const cursor = new Date(`${dates[0]}T12:00:00Z`);
  const end = new Date(`${dates[dates.length - 1]}T12:00:00Z`);

  let missing = 0;
  while (cursor < end) {
    cursor.setUTCDate(cursor.getUTCDate() + 1);
    const day = cursor.getUTCDay();
    if (day === 0 || day === 6) continue;
    if (!have.has(cursor.toISOString().slice(0, 10))) missing += 1;
  }
  return missing;
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

/**
 * What the investments had made or lost by each day, in money.
 *
 * The value less what it started the period at and less everything paid in
 * since, so a deposit is a step in neither direction. Plotting the value
 * itself showed a twelve-thousand-dollar deposit as a leap that looked like a
 * gain. Same end-of-day flow convention as the index, so the last point is
 * the period's gain.
 */
export function madeOrLostSeries(
  points: { date: string; value: number }[],
  flows: CashFlow[],
): { date: string; value: number }[] {
  if (points.length === 0) return [];
  const start = points[0];
  const later = flows
    .filter((flow) => flow.date > start.date)
    .sort((a, b) => a.date.localeCompare(b.date));

  let paidIn = 0;
  let next = 0;
  return points.map((point) => {
    while (next < later.length && later[next].date <= point.date) {
      paidIn += later[next].amount;
      next += 1;
    }
    return { date: point.date, value: point.value - start.value - paidIn };
  });
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

export type PayoffProfile = {
  /** Share prices at expiry where the position exactly breaks even. */
  breakEvens: number[];
  /** Best result at expiry; Infinity when a rising share keeps paying. */
  maxProfit: number;
  /** Worst result at expiry; -Infinity when a rising share keeps costing. */
  maxLoss: number;
};

/**
 * Break-even, best case and worst case at expiry, exactly.
 *
 * An option position held to expiry is a straight line between strikes, so
 * nothing needs sampling: its extremes sit at zero, at a strike, or run off
 * to infinity past the highest strike, and its break-evens are where one of
 * those straight pieces crosses zero. Beyond the highest strike only the
 * calls still move, so their quantities alone say whether the position gains
 * or loses without limit as the share rises.
 */
export function payoffProfile(legs: PayoffLeg[], fees = 0): PayoffProfile {
  if (legs.length === 0) return { breakEvens: [], maxProfit: 0, maxLoss: 0 };

  const kinks = [0, ...new Set(legs.map((leg) => leg.strike))].sort((a, b) => a - b);
  const values = kinks.map((price) => expirationPayoff(legs, price, fees));
  const slopeAbove = legs
    .filter((leg) => leg.type === "call")
    .reduce((sum, leg) => sum + leg.quantity * leg.multiplier, 0);

  const breakEvens: number[] = [];
  for (let i = 1; i < kinks.length; i += 1) {
    const [a, b] = [kinks[i - 1], kinks[i]];
    const [pa, pb] = [values[i - 1], values[i]];
    if (pa === 0 && i === 1) breakEvens.push(a);
    if (pb === 0) breakEvens.push(b);
    else if ((pa < 0 && pb > 0) || (pa > 0 && pb < 0)) {
      breakEvens.push(a + ((0 - pa) * (b - a)) / (pb - pa));
    }
  }
  const last = kinks[kinks.length - 1];
  const atLast = values[values.length - 1];
  if (slopeAbove !== 0 && atLast !== 0 && Math.sign(atLast) !== Math.sign(slopeAbove)) {
    breakEvens.push(last - atLast / slopeAbove);
  }

  return {
    breakEvens: [...new Set(breakEvens.map((price) => Math.round(price * 100) / 100))],
    maxProfit: slopeAbove > 0 ? Infinity : Math.max(...values),
    maxLoss: slopeAbove < 0 ? -Infinity : Math.min(...values),
  };
}
