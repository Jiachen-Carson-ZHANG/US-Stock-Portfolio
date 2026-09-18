export type MarketSession = "pre-market" | "regular" | "after-hours" | "closed";

export type Quote = {
  symbol: string;
  price: number;
  previousClose: number;
  change: number;
  changePercent: number;
  marketStatus: MarketSession;
  dataTimestamp: string;
  source: string;
};

export type HistoricalPrice = {
  date: string;
  close: number;
};

export type DateRange = {
  from: string;
  to: string;
};
