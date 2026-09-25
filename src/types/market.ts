export type MarketSession = "pre-market" | "regular" | "after-hours" | "closed";

/**
 * What the broker publishes about an option beyond its price.
 *
 * These are the market's own numbers, not ours. Implied volatility is the
 * figure the price was quoted with; delta says how much the contract moves
 * for a one-dollar move in the share; theta is what a day of waiting costs.
 * Every field is optional because a share has none of them and a feed can
 * omit any of them.
 */
export type OptionGreeks = {
  impliedVolatility?: number;
  delta?: number;
  gamma?: number;
  theta?: number;
  vega?: number;
  rho?: number;
  openInterest?: number;
};

export type Quote = {
  symbol: string;
  name?: string;
  price: number;
  previousClose: number;
  change: number;
  changePercent: number;
  marketStatus: MarketSession;
  dataTimestamp: string;
  source: string;
  /** Present only for option contracts, and only when the feed sends them. */
  greeks?: OptionGreeks;
  /**
   * The rest of what the broker publishes beside the price: where it opened,
   * how far it has travelled today, and how much has changed hands.
   *
   * A price on its own is the least informative number on a trading screen.
   * "212.40" says nothing about whether that is the high of the day or the
   * low of it, and the answer changes what a limit order should be.
   */
  session?: {
    open?: number;
    high?: number;
    low?: number;
    volume?: number;
    turnover?: number;
  };
  /** The broker's snapshot as it arrived, for the detail panels to draw from. */
  raw?: Record<string, unknown>;
};

/** A listed expiry for an underlying's options. */
export type OptionExpiration = { date: string; days: number; cycle?: string };

/** One contract in an option chain, before it is priced. */
export type OptionContract = {
  symbol: string;
  type: "call" | "put";
  strike: number;
  expiry: string;
  multiplier: number;
};

export type HistoricalPrice = {
  date: string;
  close: number;
};

export type DateRange = {
  from: string;
  to: string;
};
