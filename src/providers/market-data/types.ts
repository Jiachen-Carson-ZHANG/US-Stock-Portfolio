import type { DateRange, HistoricalPrice, Quote } from "@/types/market";

export interface MarketDataProvider {
  getQuotes(symbols: string[]): Promise<Quote[]>;
  getHistoricalPrices(symbol: string, range: DateRange): Promise<HistoricalPrice[]>;
}
