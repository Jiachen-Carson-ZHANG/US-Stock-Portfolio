export type SeriesStats = {
  periodReturnPercent: number | null;
  maxDrawdownPercent: number | null;
  annualisedVolatilityPercent: number | null;
  bestDayPercent: number | null;
  worstDayPercent: number | null;
};

const TRADING_DAYS_PER_YEAR = 252;

export function dailyReturns(values: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < values.length; i++) {
    const previous = values[i - 1];
    if (previous <= 0) continue;
    returns.push(values[i] / previous - 1);
  }
  return returns;
}

/** Largest peak-to-trough decline in the series, as a positive percentage. */
export function maxDrawdownPercent(values: number[]): number | null {
  if (values.length < 2) return null;
  let peak = values[0];
  let worst = 0;
  for (const value of values) {
    if (value > peak) peak = value;
    if (peak > 0) worst = Math.max(worst, (peak - value) / peak);
  }
  return worst * 100;
}

export function annualisedVolatilityPercent(values: number[]): number | null {
  const returns = dailyReturns(values);
  if (returns.length < 2) return null;

  const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance =
    returns.reduce((acc, r) => acc + (r - mean) ** 2, 0) / (returns.length - 1);

  return Math.sqrt(variance) * Math.sqrt(TRADING_DAYS_PER_YEAR) * 100;
}
