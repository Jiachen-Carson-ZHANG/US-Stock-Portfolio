import type {
  BarInterval,
  DateRange,
  HistoricalPrice,
  OptionContract,
  OptionExpiration,
  Quote,
} from "@/types/market";
import type { MarketDataProvider } from "./types";
import { moomooGet, moomooPost, UnknownSymbolsError } from "@/lib/moomoo/client";
import { marketSession } from "@/lib/market-hours";

/**
 * moomoo returns option risk figures in the same snapshot as the price, under
 * `option_ex_data`. They were being dropped, and the payoff explorer was
 * reconstructing implied volatility by inverting Black-Scholes from the price
 * — a decent approximation of a number the broker was already sending.
 *
 * Field names are read defensively because a feed that renames one should
 * cost a missing greek, not a failed page.
 */
type OptionExData = {
  implied_volatility?: number | string;
  delta?: number | string;
  gamma?: number | string;
  theta?: number | string;
  vega?: number | string;
  rho?: number | string;
  open_interest?: number | string;
};

type Snapshot = {
  code: string;
  name: string;
  last_price: number;
  prev_close_price: number;
  update_time: number;
  // The day's shape, which the snapshot already carries and we were dropping.
  open_price?: number | string;
  high_price?: number | string;
  low_price?: number | string;
  volume?: number | string;
  turnover?: number | string;
  option_ex_data?: OptionExData;
};

/**
 * moomoo quotes implied volatility as a percentage and the pricing maths
 * wants a fraction, so 42.5 becomes 0.425. A value already below 5 is taken
 * as a fraction: no equity option trades at 500% vol, and a feed that changes
 * units should not silently produce a curve that is a hundred times wrong.
 */
function toNumber(value: number | string | undefined): number | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function sessionFrom(snapshot: Snapshot): Quote["session"] {
  const shape = {
    open: toNumber(snapshot.open_price),
    high: toNumber(snapshot.high_price),
    low: toNumber(snapshot.low_price),
    volume: toNumber(snapshot.volume),
    turnover: toNumber(snapshot.turnover),
  };
  return Object.values(shape).some((value) => value !== undefined) ? shape : undefined;
}

/**
 * An option's figures, wherever in the snapshot they turn up.
 *
 * The first version looked for them nested under option_ex_data and found
 * nothing — every contract came back with no greeks at all. The fields that
 * *are* read successfully (open_price, high_price, volume…) follow moomoo's
 * flat snapshot naming, and in that naming the option figures are flat too:
 * option_delta, option_implied_volatility. Both shapes are read now, flat
 * first, so the next change of shape costs nothing rather than silently
 * blanking every delta on the site.
 */
function greeksFrom(snapshot: Snapshot): Quote["greeks"] {
  const flat = snapshot as unknown as Record<string, number | string | undefined>;
  const nested = (snapshot.option_ex_data ?? {}) as Record<string, number | string | undefined>;

  const pick = (...names: string[]) => {
    for (const name of names) {
      const value = toNumber(flat[name] ?? nested[name]);
      if (value !== undefined) return value;
    }
    return undefined;
  };

  // Quoted as a percentage (42.5), wanted as a fraction (0.425). Anything
  // already below 5 is taken to be a fraction: no equity option trades at
  // 500% volatility, and a feed that changes units should not silently draw
  // a curve a hundred times wrong.
  const rawVol = pick("option_implied_volatility", "implied_volatility");
  const impliedVolatility =
    rawVol === undefined ? undefined : rawVol > 5 ? rawVol / 100 : rawVol;

  const greeks = {
    impliedVolatility,
    delta: pick("option_delta", "delta"),
    gamma: pick("option_gamma", "gamma"),
    theta: pick("option_theta", "theta"),
    vega: pick("option_vega", "vega"),
    rho: pick("option_rho", "rho"),
    openInterest: pick("option_open_interest", "open_interest"),
  };

  return Object.values(greeks).some((value) => value !== undefined)
    ? greeks
    : undefined;
}

type Kline = {
  date: number;
  /** When the bar starts, in milliseconds. */
  time_key?: number;
  close: number;
  open?: number;
  high?: number;
  low?: number;
  volume?: number;
  turnover?: number;
};

const SNAPSHOT_BATCH = 400;

/** moomoo's K-line types, from its naming dictionary. */
const KTYPE: Record<BarInterval, string> = {
  "5m": "6",
  "30m": "8",
  day: "2",
  week: "3",
  month: "4",
};

function market(): string {
  return process.env.MOOMOO_MARKET ?? "US";
}

/** Cash rows carry no quote; everything else is {MARKET}.{CODE} to moomoo. */
function isCash(symbol: string): boolean {
  return symbol.endsWith(".CASH");
}

/**
 * The markets moomoo writes in front of a code: US.AAPL, HK.00700, SG.D05.
 *
 * Named rather than inferred from "has a dot": US tickers have dots of their
 * own — BRK.B, BF.B and 170 more — and were being sent as if "BRK" were a
 * market, so moomoo had no price for them.
 */
const MARKET_PREFIX = /^(US|HK|SH|SZ|SG|JP|AU|MY|CA)\./;

function toMoomooCode(symbol: string): string {
  return MARKET_PREFIX.test(symbol) ? symbol : `${market()}.${symbol}`;
}

/**
 * Back to the symbol the caller asked with: the home market's prefix comes
 * off, any other market's stays, so a Hong Kong code is not mistaken for a US
 * ticker of the same digits.
 */
function fromMoomooCode(code: string): string {
  const home = `${market()}.`;
  return code.startsWith(home) ? code.slice(home.length) : code;
}

function isoDate(yyyymmdd: number): string {
  const value = String(yyyymmdd);
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

/** moomoo's "valid underlying, but nothing here" — an answer, not a failure. */
async function noDataAsEmpty<T>(work: () => Promise<T>): Promise<T | null> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof Error && /error -10\b/.test(error.message)) return null;
    throw error;
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export class MoomooMarketDataProvider implements MarketDataProvider {
  /**
   * Quotes are not private, but fetching them still spends someone's token, so
   * the provider is told whose. Callers pass the portfolio being viewed.
   */
  constructor(private readonly portfolioId: string) {}

  async getQuotes(symbols: string[]): Promise<Quote[]> {
    const tradable = symbols.filter((symbol) => !isCash(symbol));
    if (tradable.length === 0) return [];

    const status = marketSession();
    const quotes: Quote[] = [];

    for (const batch of chunk(tradable, SNAPSHOT_BATCH)) {
      let data: { snapshot_list: Snapshot[] };
      try {
        data = await moomooPost<{ snapshot_list: Snapshot[] }>(
          this.portfolioId,
          "/api/v1.0/quote/snapshot",
          { code_list: batch.map(toMoomooCode) },
        );
      } catch (error) {
        // Nothing in this batch is a symbol moomoo knows. That is a fact
        // about the symbols, not about the connection, so the other batches
        // continue and the caller simply gets no price for these.
        if (error instanceof UnknownSymbolsError) continue;
        throw error;
      }

      for (const snapshot of data.snapshot_list ?? []) {
        const change = snapshot.last_price - snapshot.prev_close_price;
        quotes.push({
          symbol: fromMoomooCode(snapshot.code),
          name: snapshot.name,
          price: snapshot.last_price,
          previousClose: snapshot.prev_close_price,
          change,
          changePercent:
            snapshot.prev_close_price === 0
              ? 0
              : (change / snapshot.prev_close_price) * 100,
          marketStatus: status,
          dataTimestamp: new Date(snapshot.update_time).toISOString(),
          source: "moomoo",
          greeks: greeksFrom(snapshot),
          // Everything moomoo sent, kept whole. Public market data, and the
          // only way to show what the broker shows without guessing which
          // fields exist before being told.
          raw: snapshot as unknown as Record<string, unknown>,
          session: sessionFrom(snapshot),
        });
      }
    }

    return quotes;
  }

  /**
   * Expiries listed for an underlying, from moomoo's option-expiration
   * endpoint. Past dates are dropped; "no options on this" (-10) is an
   * answer, so it comes back as an empty list rather than an error.
   */
  async getOptionExpirations(symbol: string): Promise<OptionExpiration[]> {
    const data = await noDataAsEmpty(() =>
      moomooGet<{
        expiration_list?: {
          strike_time: string;
          option_expiry_date_distance: number;
          expiration_cycle?: string;
        }[];
      }>(
        this.portfolioId,
        `/api/v1.0/quote/${encodeURIComponent(toMoomooCode(symbol))}/option-expiration`,
      ),
    );
    return (data?.expiration_list ?? [])
      .filter((row) => row.option_expiry_date_distance >= 0)
      .map((row) => ({
        date: row.strike_time,
        days: row.option_expiry_date_distance,
        cycle: row.expiration_cycle,
      }));
  }

  /**
   * Every contract on one expiry. moomoo returns names and strikes but no
   * prices; those come from the same snapshot every other price does.
   */
  async getOptionChain(symbol: string, expiry: string): Promise<OptionContract[]> {
    const query = new URLSearchParams({ start: expiry, end: expiry });
    const data = await noDataAsEmpty(() =>
      moomooGet<{
        option_chain?: {
          code: string;
          option_type: string;
          strike_price: number;
          strike_time: string;
          lot_size?: number;
        }[];
      }>(
        this.portfolioId,
        `/api/v1.0/quote/${encodeURIComponent(toMoomooCode(symbol))}/option-chain?${query}`,
      ),
    );
    return (data?.option_chain ?? []).map((row) => ({
      symbol: fromMoomooCode(row.code),
      type: row.option_type === "PUT" ? ("put" as const) : ("call" as const),
      strike: row.strike_price,
      expiry: row.strike_time,
      multiplier: row.lot_size && row.lot_size > 0 ? row.lot_size : 100,
    }));
  }

  async getHistoricalPrices(
    symbol: string,
    range: DateRange,
    options: { interval?: BarInterval } = {},
  ): Promise<HistoricalPrice[]> {
    if (isCash(symbol)) return [];

    const interval = options.interval ?? "day";
    const query = new URLSearchParams({
      start: range.from,
      end: range.to,
      ktype: KTYPE[interval],
      autype: "1",
      num: "370",
    });

    const data = await moomooGet<{ kline_list: Kline[] }>(
      this.portfolioId,
      `/api/v1.0/quote/${encodeURIComponent(toMoomooCode(symbol))}/history-kline?${query}`,
    );

    const intraday = interval === "5m" || interval === "30m";
    return (data.kline_list ?? []).map((bar) => ({
      date: isoDate(bar.date),
      ...(intraday && bar.time_key ? { time: new Date(bar.time_key).toISOString() } : {}),
      close: bar.close,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      volume: bar.volume,
      turnover: bar.turnover,
    }));
  }
}
