import type { DateRange, HistoricalPrice, Quote } from "@/types/market";
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

function greeksFrom(data: OptionExData | undefined): Quote["greeks"] {
  if (!data) return undefined;

  const raw = toNumber(data.implied_volatility);
  const impliedVolatility =
    raw === undefined ? undefined : raw > 5 ? raw / 100 : raw;

  const greeks = {
    impliedVolatility,
    delta: toNumber(data.delta),
    gamma: toNumber(data.gamma),
    theta: toNumber(data.theta),
    vega: toNumber(data.vega),
    rho: toNumber(data.rho),
    openInterest: toNumber(data.open_interest),
  };

  return Object.values(greeks).some((value) => value !== undefined)
    ? greeks
    : undefined;
}

type Kline = {
  date: number;
  close: number;
};

const SNAPSHOT_BATCH = 400;

function market(): string {
  return process.env.MOOMOO_MARKET ?? "US";
}

/** Cash rows carry no quote; everything else is {MARKET}.{CODE} to moomoo. */
function isCash(symbol: string): boolean {
  return symbol.endsWith(".CASH");
}

function toMoomooCode(symbol: string): string {
  return symbol.includes(".") ? symbol : `${market()}.${symbol}`;
}

function fromMoomooCode(code: string): string {
  const separator = code.indexOf(".");
  return separator === -1 ? code : code.slice(separator + 1);
}

function isoDate(yyyymmdd: number): string {
  const value = String(yyyymmdd);
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
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
          greeks: greeksFrom(snapshot.option_ex_data),
        });
      }
    }

    return quotes;
  }

  async getHistoricalPrices(
    symbol: string,
    range: DateRange,
  ): Promise<HistoricalPrice[]> {
    if (isCash(symbol)) return [];

    const query = new URLSearchParams({
      start: range.from,
      end: range.to,
      ktype: "2",
      autype: "1",
      num: "370",
    });

    const data = await moomooGet<{ kline_list: Kline[] }>(
      this.portfolioId,
      `/api/v1.0/quote/${encodeURIComponent(toMoomooCode(symbol))}/history-kline?${query}`,
    );

    return (data.kline_list ?? []).map((bar) => ({
      date: isoDate(bar.date),
      close: bar.close,
    }));
  }
}
