import type { DateRange, HistoricalPrice, Quote } from "@/types/market";
import type { MarketDataProvider } from "./types";
import { marketSession } from "@/lib/market-hours";
import { MOCK_PRICES } from "../mock-portfolio";

/** Deterministic hash → [0,1). Keeps mock history identical across reloads. */
function seededUnit(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

function eachDay(range: DateRange): string[] {
  const days: string[] = [];
  const cursor = new Date(`${range.from}T00:00:00Z`);
  const end = new Date(`${range.to}T00:00:00Z`);
  while (cursor <= end) {
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) {
      days.push(cursor.toISOString().slice(0, 10));
    }
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return days;
}

export class MockMarketDataProvider implements MarketDataProvider {
  async getQuotes(symbols: string[]): Promise<Quote[]> {
    const status = marketSession();
    const timestamp = new Date().toISOString();

    return symbols
      .filter((symbol) => symbol in MOCK_PRICES)
      .map((symbol) => {
        const { price, previousClose } = MOCK_PRICES[symbol];
        const change = price - previousClose;
        return {
          symbol,
          price,
          previousClose,
          change,
          changePercent: previousClose === 0 ? 0 : (change / previousClose) * 100,
          marketStatus: status,
          dataTimestamp: timestamp,
          source: "mock",
        };
      });
  }

  async getHistoricalPrices(
    symbol: string,
    range: DateRange,
  ): Promise<HistoricalPrice[]> {
    const base = MOCK_PRICES[symbol];
    if (!base) return [];

    const days = eachDay(range);
    if (days.length === 0) return [];

    // Walk backwards from the live price so the series ends where the quote is.
    const series: HistoricalPrice[] = [];
    let close = base.price;
    for (let i = days.length - 1; i >= 0; i--) {
      series.unshift({ date: days[i], close: Number(close.toFixed(2)) });
      const drift = (seededUnit(`${symbol}:${days[i]}`) - 0.48) * 0.028;
      close = Math.max(0.01, close / (1 + drift));
    }
    return series;
  }
}
