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

  /**
   * Figures the broker states directly. Preferred over deriving from cost and
   * price: a broker reduces cost basis by realized proceeds, so a position that
   * has been partly sold can carry a negative cost_price, and deriving from it
   * silently reports total P&L under the unrealized label.
   */
  /** The broker's own mark. Preferred over a quote feed so displayed price,
   *  quantity and market value agree with each other and with the broker app. */
  reportedPrice?: number;
  reportedMarketValue?: number;
  reportedUnrealizedPnL?: number;
  reportedTodayPnL?: number;
  reportedRealizedPnL?: number;

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
  /** Net value of written/short positions. Zero when none are held. */
  shortExposure: MoneyDTO;
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
