import type { DateRange, HistoricalPrice, Quote } from "@/types/market";
import type { MarketDataProvider } from "./types";
import { moomooGet, moomooPost } from "@/lib/moomoo/client";
import { marketSession } from "@/lib/market-hours";

type Snapshot = {
  code: string;
  name: string;
  last_price: number;
  prev_close_price: number;
  update_time: number;
};

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
      const data = await moomooPost<{ snapshot_list: Snapshot[] }>(
      this.portfolioId,
        "/api/v1.0/quote/snapshot",
        { code_list: batch.map(toMoomooCode) },
      );

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
