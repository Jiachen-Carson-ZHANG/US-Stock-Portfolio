import type {
  DateRange,
  HistoricalPrice,
  OptionContract,
  OptionExpiration,
  Quote,
} from "@/types/market";
import type { MarketDataProvider } from "./types";
import { marketSession } from "@/lib/market-hours";
import { blackScholes, cdf, yearsUntil } from "@/lib/analysis/options-pricing";
import { parseSymbol } from "@/lib/moomoo/symbols";
import { MOCK_PRICES } from "../mock-portfolio";

/** The volatility every synthetic contract is priced at. */
const MOCK_VOL = 0.45;

/**
 * A made-up contract on a made-up price, priced the way the market would:
 * Black-Scholes at one volatility, with a bid and ask a few cents apart.
 * Enough for the option finder to be tried without a broker connection.
 */
function mockOptionQuote(symbol: string, status: Quote["marketStatus"], timestamp: string): Quote | null {
  const parsed = parseSymbol(symbol);
  if (parsed.instrumentType !== "option" || !parsed.underlyingSymbol) return null;
  const base = MOCK_PRICES[parsed.underlyingSymbol];
  if (!base || !parsed.strike || !parsed.optionType || !parsed.expirationDate) return null;

  const years = yearsUntil(parsed.expirationDate);
  const price = blackScholes(parsed.optionType, base.price, parsed.strike, years, 0.04, MOCK_VOL);
  const spread = Math.max(0.02, price * 0.02);
  const d1 =
    years > 0
      ? (Math.log(base.price / parsed.strike) + (0.04 + 0.5 * MOCK_VOL ** 2) * years) /
        (MOCK_VOL * Math.sqrt(years))
      : 0;
  const delta = parsed.optionType === "call" ? cdf(d1) : cdf(d1) - 1;
  const round = (n: number) => Math.round(n * 100) / 100;

  return {
    symbol,
    name: symbol,
    price: round(price),
    previousClose: round(price),
    change: 0,
    changePercent: 0,
    marketStatus: status,
    dataTimestamp: timestamp,
    source: "mock",
    greeks: { impliedVolatility: MOCK_VOL, delta, openInterest: 1000 },
    raw: {
      bid_price: round(Math.max(0.01, price - spread / 2)),
      ask_price: round(price + spread / 2),
      option_implied_volatility: MOCK_VOL * 100,
      delta,
      option_open_interest: 1000,
    },
  };
}

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

    const options = symbols
      .filter((symbol) => !(symbol in MOCK_PRICES))
      .flatMap((symbol) => mockOptionQuote(symbol, status, timestamp) ?? []);

    return symbols
      .filter((symbol) => symbol in MOCK_PRICES)
      .map((symbol) => {
        const { price, previousClose } = MOCK_PRICES[symbol];
        const change = price - previousClose;
        return {
          symbol,
          name: symbol,
          price,
          previousClose,
          change,
          changePercent: previousClose === 0 ? 0 : (change / previousClose) * 100,
          marketStatus: status,
          dataTimestamp: timestamp,
          source: "mock",
          // The fields a broker snapshot carries, made up but consistent with
          // the price, so pages can be tried without a broker.
          raw: {
            last_price: price,
            prev_close_price: previousClose,
            open_price: previousClose,
            high_price: Math.max(price, previousClose) * 1.01,
            low_price: Math.min(price, previousClose) * 0.99,
            bid_price: Number((price - 0.02).toFixed(2)),
            bid_vol: 300,
            ask_price: Number((price + 0.02).toFixed(2)),
            ask_vol: 200,
            volume: 21_000_000,
            turnover: Math.round(21_000_000 * price),
            highest52weeks_price: price * 1.25,
            lowest52weeks_price: price * 0.7,
            pe_ttm_ratio: 28.4,
            pb_ratio: 9.1,
            total_market_val: price * 1_500_000_000,
            earning_per_share: price / 28.4,
            dividend_ratio_ttm: 0.5,
            outstanding_shares: 1_500_000_000,
            turnover_rate: 1.4,
            volume_ratio: 1.1,
            amplitude: 2.1,
          },
        } as Quote;
      })
      .concat(options);
  }

  /** The next six Fridays. */
  async getOptionExpirations(symbol: string): Promise<OptionExpiration[]> {
    if (!(symbol in MOCK_PRICES)) return [];
    const out: OptionExpiration[] = [];
    const day = new Date();
    while (out.length < 6) {
      day.setUTCDate(day.getUTCDate() + 1);
      if (day.getUTCDay() !== 5) continue;
      out.push({
        date: day.toISOString().slice(0, 10),
        days: Math.round((day.getTime() - Date.now()) / 86_400_000),
        cycle: "WEEK",
      });
    }
    return out;
  }

  /** Strikes every 5% of the price, from half to one and a half times it. */
  async getOptionChain(symbol: string, expiry: string): Promise<OptionContract[]> {
    const base = MOCK_PRICES[symbol];
    if (!base) return [];
    const step = Math.max(1, Math.round(base.price * 0.025));
    const yymmdd = expiry.slice(2).replaceAll("-", "");
    const contracts: OptionContract[] = [];
    for (let strike = Math.ceil((base.price * 0.7) / step) * step; strike <= base.price * 1.3; strike += step) {
      for (const type of ["call", "put"] as const) {
        contracts.push({
          symbol: `${symbol}${yymmdd}${type === "call" ? "C" : "P"}${String(strike * 1000).padStart(8, "0")}`,
          type,
          strike,
          expiry,
          multiplier: 100,
        });
      }
    }
    return contracts;
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
      // A made-up but plausible day's trading, so the volume chart has
      // something to draw without a broker.
      const shares = Math.round(2_000_000 * (0.5 + seededUnit(`${symbol}:v:${days[i]}`)));
      series.unshift({
        date: days[i],
        close: Number(close.toFixed(2)),
        volume: shares,
        turnover: Math.round(shares * close),
      });
      const drift = (seededUnit(`${symbol}:${days[i]}`) - 0.48) * 0.028;
      close = Math.max(0.01, close / (1 + drift));
    }
    return series;
  }
}
