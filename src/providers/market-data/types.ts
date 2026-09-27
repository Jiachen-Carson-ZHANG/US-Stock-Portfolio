import type {
  BarInterval,
  DateRange,
  HistoricalPrice,
  OptionContract,
  OptionExpiration,
  Quote,
} from "@/types/market";

export interface MarketDataProvider {
  getQuotes(symbols: string[]): Promise<Quote[]>;
  /** Daily bars unless another interval is asked for. */
  getHistoricalPrices(
    symbol: string,
    range: DateRange,
    options?: { interval?: BarInterval },
  ): Promise<HistoricalPrice[]>;
  /** The expiries listed for an underlying's options, nearest first. */
  getOptionExpirations?(symbol: string): Promise<OptionExpiration[]>;
  /** Every contract on one expiry, unpriced; prices come from getQuotes. */
  getOptionChain?(symbol: string, expiry: string): Promise<OptionContract[]>;
}
