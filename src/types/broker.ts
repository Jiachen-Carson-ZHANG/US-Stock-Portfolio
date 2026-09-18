import type { InstrumentType } from "./portfolio";

export type BrokerAccount = {
  id: string;
  broker: "moomoo" | "mock";
  accountMask: string;
  currency: string;
};

export type BrokerPosition = {
  symbol: string;
  underlyingSymbol?: string;
  name?: string;
  instrumentType: InstrumentType;
  quantity: number;
  averageCost: number;
  currency: string;
  sector?: string;
  optionType?: "call" | "put";
  strike?: number;
  expirationDate?: string;
  contractMultiplier?: number;

  reportedPrice?: number;
  reportedMarketValue?: number;
  reportedUnrealizedPnL?: number;
  reportedTodayPnL?: number;
  reportedRealizedPnL?: number;
};

export type AccountSummary = {
  accountId: string;
  currency: string;
  cash: number;
  syncedAt: string;
};

export type BrokerTransaction = {
  dealId: string;
  orderId: string;
  side: "buy" | "sell";
  symbol: string;
  name?: string;
  quantity: number;
  price: number;
  /** Signed cash effect: negative when buying, positive when selling. */
  amount: number;
  tradedAt: string;
};
