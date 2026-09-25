import type {
  DateRange,
  HistoricalPrice,
  OptionContract,
  OptionExpiration,
  Quote,
} from "@/types/market";

export interface MarketDataProvider {
  getQuotes(symbols: string[]): Promise<Quote[]>;
  getHistoricalPrices(symbol: string, range: DateRange): Promise<HistoricalPrice[]>;
  /** The expiries listed for an underlying's options, nearest first. */
  getOptionExpirations?(symbol: string): Promise<OptionExpiration[]>;
  /** Every contract on one expiry, unpriced; prices come from getQuotes. */
  getOptionChain?(symbol: string, expiry: string): Promise<OptionContract[]>;
}
