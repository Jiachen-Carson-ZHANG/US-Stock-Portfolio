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
};

export type AccountSummary = {
  accountId: string;
  currency: string;
  cash: number;
  syncedAt: string;
};
