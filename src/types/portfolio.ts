import type Decimal from "decimal.js";
import type { MarketSession } from "./market";

export type InstrumentType = "stock" | "etf" | "option" | "cash" | "other";

export type Money = {
  amount: Decimal;
  currency: string;
};

/** Wire format for Money. Decimal is not JSON-safe, so amount crosses as a string. */
export type MoneyDTO = {
  amount: string;
  currency: string;
};

export type Position = {
  id: string;
  broker: "moomoo" | "mock";
  instrumentType: InstrumentType;

  symbol: string;
  underlyingSymbol?: string;
  name?: string;
  sector?: string;

  quantity: number;

  averageCost?: number;
  currentPrice?: number;
  previousClose?: number;

  currency: string;

  optionType?: "call" | "put";
  strike?: number;
  expirationDate?: string;
  contractMultiplier?: number;

  lastUpdatedAt: string;
};

export type PositionMetrics = {
  marketValue: MoneyDTO;
  costBasis: MoneyDTO;
  unrealizedPnL: MoneyDTO;
  unrealizedPnLPercent: number | null;
  todayPnL: MoneyDTO;
  todayPnLPercent: number | null;
  weightPercent: number;
};

export type PositionView = Position & PositionMetrics;

export type PortfolioSummary = {
  totalMarketValue: MoneyDTO;
  totalCostBasis: MoneyDTO;
  totalUnrealizedPnL: MoneyDTO;
  totalUnrealizedPnLPercent: number | null;
  todayPnL: MoneyDTO;
  todayPnLPercent: number | null;
  cashValue: MoneyDTO;
  cashPercent: number;
  positionCount: number;
  marketStatus: MarketSession;
  dataTimestamp: string | null;
  isStale: boolean;
};

export type Concentration = {
  top1Percent: number;
  top3Percent: number;
  top5Percent: number;
};

export type AllocationSlice = {
  key: string;
  label: string;
  value: string;
  percent: number;
};

export type PortfolioSnapshot = {
  snapshotDate: string;
  totalMarketValue: string;
  totalCost: string;
  totalUnrealizedPnL: string;
  cashValue: string;
};
