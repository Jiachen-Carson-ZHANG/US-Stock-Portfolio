/**
 * Where a share has actually changed hands, by price.
 *
 * Each day's money traded is spread evenly across that day's range — from its
 * low to its high — and added into price bands. Prices where a great deal
 * changed hands tend to matter afterwards: people who bought there remember
 * the price. It is an approximation (a day's trading is not really spread
 * evenly across its range), but it uses only the daily figures every feed
 * has, and it is honest about which prices were busy.
 *
 * Money traded rather than shares, so that a share count that changes — a
 * split, or new shares issued — does not distort the comparison.
 */
export type PriceBand = { from: number; to: number; traded: number };

export function tradedByPrice(
  bars: { close: number; high?: number; low?: number; turnover?: number; volume?: number }[],
  bands = 12,
): PriceBand[] {
  const days = bars
    .map((bar) => {
      const low = bar.low !== undefined && bar.low > 0 ? bar.low : bar.close;
      const high = bar.high !== undefined && bar.high >= low ? bar.high : bar.close;
      const traded = bar.turnover ?? (bar.volume !== undefined ? bar.volume * bar.close : 0);
      return { low: Math.min(low, bar.close), high: Math.max(high, bar.close), traded };
    })
    .filter((day) => day.traded > 0 && day.high > 0);
  if (days.length === 0 || bands < 1) return [];

  const floor = Math.min(...days.map((day) => day.low));
  const ceiling = Math.max(...days.map((day) => day.high));
  const width = (ceiling - floor) / bands || 1;
  const result: PriceBand[] = Array.from({ length: bands }, (_, index) => ({
    from: floor + index * width,
    to: floor + (index + 1) * width,
    traded: 0,
  }));

  for (const day of days) {
    const span = day.high - day.low;
    if (span <= 0) {
      const index = Math.min(bands - 1, Math.floor((day.low - floor) / width));
      result[index].traded += day.traded;
      continue;
    }
    for (const band of result) {
      const overlap = Math.min(band.to, day.high) - Math.max(band.from, day.low);
      if (overlap > 0) band.traded += (day.traded * overlap) / span;
    }
  }
  return result;
}
