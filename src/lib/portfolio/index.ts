import Decimal from "decimal.js";
import type {
  AllocationSlice,
  Concentration,
  Money,
  PortfolioSummary,
  Position,
  PositionMetrics,
  PositionView,
} from "@/types/portfolio";
import type { MarketSession } from "@/types/market";
import { add, money, percentOf, subtract, sum, toDTO, zero } from "@/lib/money";

export const DEFAULT_CONTRACT_MULTIPLIER = 100;

/**
 * Options are priced per contract unit, so every notional figure scales by the
 * contract multiplier. Getting this wrong understates an option position 100x.
 */
export function contractMultiplier(position: Position): Decimal {
  if (position.instrumentType !== "option") return new Decimal(1);
  return new Decimal(position.contractMultiplier ?? DEFAULT_CONTRACT_MULTIPLIER);
}

/** Live quote when one is available, else the broker's value from last sync. */
export function marketValue(position: Position): Money {
  if (position.instrumentType === "cash") {
    return money(position.quantity, position.currency);
  }
  if (position.currentPrice !== undefined) {
    return money(
      new Decimal(position.quantity)
        .times(position.currentPrice)
        .times(contractMultiplier(position)),
      position.currency,
    );
  }
  if (position.reportedMarketValue !== undefined) {
    return money(position.reportedMarketValue, position.currency);
  }
  return zero(position.currency);
}

/**
 * Brokers net realized proceeds against cost, which can drive averageCost
 * negative — deriving from it then reports total P&L as if it were unrealized.
 * Where the broker states both a market value and an unrealized figure, their
 * difference is the only cost that reconciles with the account.
 */
export function costBasis(position: Position): Money {
  if (position.instrumentType === "cash") {
    return money(position.quantity, position.currency);
  }
  if (
    position.reportedMarketValue !== undefined &&
    position.reportedUnrealizedPnL !== undefined
  ) {
    return money(
      new Decimal(position.reportedMarketValue).minus(position.reportedUnrealizedPnL),
      position.currency,
    );
  }
  if (position.averageCost === undefined) return zero(position.currency);
  return money(
    new Decimal(position.quantity)
      .times(position.averageCost)
      .times(contractMultiplier(position)),
    position.currency,
  );
}

export function unrealizedPnL(position: Position): Money {
  if (position.instrumentType === "cash") return zero(position.currency);
  return subtract(marketValue(position), costBasis(position));
}

/**
 * The broker's own figure first. Deriving it instead would subtract a quote
 * feed's previous close from the broker's mark — two different bases, which on
 * a thinly traded option shows a multi-percent move that never happened.
 */
export function todayPnL(position: Position): Money {
  if (position.instrumentType === "cash") return zero(position.currency);
  if (position.reportedTodayPnL !== undefined) {
    return money(position.reportedTodayPnL, position.currency);
  }
  if (position.currentPrice !== undefined && position.previousClose !== undefined) {
    return money(
      new Decimal(position.currentPrice)
        .minus(position.previousClose)
        .times(position.quantity)
        .times(contractMultiplier(position)),
      position.currency,
    );
  }
  return zero(position.currency);
}

/** What the position was worth at the previous close, by definition. */
function previousCloseValue(position: Position): Money {
  if (position.instrumentType === "cash") {
    return money(position.quantity, position.currency);
  }
  return subtract(marketValue(position), todayPnL(position));
}

export function metricsFor(position: Position, totalValue: Money): PositionMetrics {
  const mv = marketValue(position);
  const cb = costBasis(position);
  const pnl = unrealizedPnL(position);
  const today = todayPnL(position);

  return {
    marketValue: toDTO(mv),
    costBasis: toDTO(cb),
    unrealizedPnL: toDTO(pnl),
    unrealizedPnLPercent: percentOf(pnl, cb),
    todayPnL: toDTO(today),
    todayPnLPercent: percentOf(today, previousCloseValue(position)),
    weightPercent: percentOf(mv, totalValue) ?? 0,
  };
}

export function totalMarketValue(positions: Position[], currency: string): Money {
  return sum(positions.map(marketValue), currency);
}

export function buildPositionViews(
  positions: Position[],
  currency: string,
): PositionView[] {
  const total = totalMarketValue(positions, currency);
  return positions
    .map((position) => ({ ...position, ...metricsFor(position, total) }))
    .sort((a, b) => Number(b.marketValue.amount) - Number(a.marketValue.amount));
}

export function summarize(
  positions: Position[],
  currency: string,
  market: { status: MarketSession; dataTimestamp: string | null; isStale: boolean },
): PortfolioSummary {
  const total = totalMarketValue(positions, currency);
  const cost = sum(positions.map(costBasis), currency);
  const pnl = subtract(total, cost);
  const today = sum(positions.map(todayPnL), currency);
  const cash = sum(
    positions.filter((p) => p.instrumentType === "cash").map(marketValue),
    currency,
  );
  const previousTotal = sum(positions.map(previousCloseValue), currency);

  const realized = sum(
    positions.map((p) => money(p.reportedRealizedPnL ?? 0, currency)),
    currency,
  );
  const totalReturn = add(pnl, realized);
  // Capital in = what the portfolio is worth less everything it has made. It is
  // the base that makes value / capital - 1 equal the return, exactly.
  const capitalIn = subtract(total, totalReturn);

  return {
    totalMarketValue: toDTO(total),
    totalCostBasis: toDTO(cost),
    totalUnrealizedPnL: toDTO(pnl),
    totalUnrealizedPnLPercent: percentOf(pnl, cost),
    todayPnL: toDTO(today),
    todayPnLPercent: percentOf(today, previousTotal),
    cashValue: toDTO(cash),
    cashPercent: percentOf(cash, total) ?? 0,
    shortExposure: toDTO(shortExposure(positions, currency)),
    realizedPnL: toDTO(realized),
    totalReturn: toDTO(totalReturn),
    totalReturnPercent: percentOf(totalReturn, capitalIn),
    positionCount: positions.filter((p) => p.instrumentType !== "cash").length,
    marketStatus: market.status,
    dataTimestamp: market.dataTimestamp,
    isStale: market.isStale,
  };
}

/** Positions carrying positive market value — i.e. excluding written/short ones. */
export function longPositions(positions: Position[]): Position[] {
  return positions.filter((p) => marketValue(p).amount.greaterThan(0));
}

/** Net market value of positions held short, as a negative figure. */
export function shortExposure(positions: Position[], currency: string): Money {
  return sum(
    positions.filter((p) => marketValue(p).amount.isNegative()).map(marketValue),
    currency,
  );
}

/**
 * Factual share of portfolio value held in the largest N positions. Cash is
 * excluded so the figure describes invested concentration, not idle balance,
 * and short positions are excluded because a negative leg would push the
 * percentages above 100.
 */
export function concentration(positions: Position[], currency: string): Concentration {
  const invested = longPositions(positions).filter(
    (p) => p.instrumentType !== "cash",
  );
  const total = totalMarketValue(invested, currency);
  if (total.amount.isZero()) {
    return { top1Percent: 0, top3Percent: 0, top5Percent: 0 };
  }

  const sorted = invested
    .map(marketValue)
    .sort((a, b) => b.amount.comparedTo(a.amount));

  const topN = (n: number) =>
    percentOf(sum(sorted.slice(0, n), currency), total) ?? 0;

  return { top1Percent: topN(1), top3Percent: topN(3), top5Percent: topN(5) };
}

function toSlices(
  groups: Map<string, { label: string; value: Money }>,
  total: Money,
): AllocationSlice[] {
  return [...groups.entries()]
    .map(([key, group]) => ({
      key,
      label: group.label,
      value: group.value.amount.toFixed(),
      percent: percentOf(group.value, total) ?? 0,
    }))
    .sort((a, b) => Number(b.value) - Number(a.value));
}

/**
 * Composition is only meaningful over positive value — a part-to-whole chart
 * cannot represent a negative slice. Short positions are reported separately
 * via shortExposure rather than folded in here.
 */
function groupBy(
  positions: Position[],
  currency: string,
  keyOf: (p: Position) => { key: string; label: string } | null,
): AllocationSlice[] {
  const included = longPositions(positions);
  const groups = new Map<string, { label: string; value: Money }>();

  for (const position of included) {
    const group = keyOf(position);
    if (!group) continue;
    const existing = groups.get(group.key);
    groups.set(group.key, {
      label: group.label,
      value: existing
        ? add(existing.value, marketValue(position))
        : marketValue(position),
    });
  }

  return toSlices(groups, totalMarketValue(included, currency));
}

export function allocationByPosition(
  positions: Position[],
  currency: string,
): AllocationSlice[] {
  return groupBy(positions, currency, (p) => ({
    key: p.symbol,
    label: p.instrumentType === "cash" ? "Cash" : p.symbol,
  }));
}

const INSTRUMENT_LABELS: Record<Position["instrumentType"], string> = {
  stock: "Stocks",
  etf: "ETFs",
  option: "Options",
  cash: "Cash",
  other: "Other",
};

export function allocationByAssetType(
  positions: Position[],
  currency: string,
): AllocationSlice[] {
  return groupBy(positions, currency, (p) => ({
    key: p.instrumentType,
    label: INSTRUMENT_LABELS[p.instrumentType],
  }));
}

/** Only returns slices when sector metadata actually exists, per spec §19. */
export function allocationBySector(
  positions: Position[],
  currency: string,
): AllocationSlice[] {
  const withSector = positions.filter((p) => p.sector);
  if (withSector.length === 0) return [];
  return groupBy(withSector, currency, (p) => ({
    key: p.sector as string,
    label: p.sector as string,
  }));
}

export function daysToExpiration(
  expirationDate: string,
  now: Date = new Date(),
): number {
  const expiry = new Date(`${expirationDate}T00:00:00Z`);
  const today = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  return Math.round((expiry.getTime() - today.getTime()) / 86_400_000);
}
