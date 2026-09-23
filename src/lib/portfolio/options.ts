import Decimal from "decimal.js";
import type { AllocationSlice, Money, MoneyDTO, Position } from "@/types/portfolio";
import { add, money, sum, toDTO, zero } from "@/lib/money";
import { parseSymbol } from "@/lib/moomoo/symbols";
import {
  contractMultiplier,
  costBasis,
  marketValue,
  todayPnL,
  unrealizedPnL,
} from ".";

export type OptionStrategy =
  | "call-spread"
  | "put-spread"
  | "long-call"
  | "long-put"
  | "short-call"
  | "short-put"
  | "complex";

export type OptionGroup = {
  id: string;
  underlying: string;
  expirationDate?: string;
  strategy: OptionStrategy;
  legs: Position[];
  /** Positive = net debit paid, negative = net credit received. */
  netCost: Money;
  netMarketValue: Money;
  unrealizedPnL: Money;
  todayPnL: Money;
  /** null means unbounded — an uncovered short has no cap on its loss. */
  maxProfit: Money | null;
  maxLoss: Money | null;
  breakEven: number | null;
};

function groupKey(position: Position): string {
  return `${position.underlyingSymbol ?? position.symbol}|${position.expirationDate ?? ""}`;
}

function singleLegStrategy(leg: Position): OptionStrategy {
  const long = leg.quantity > 0;
  if (leg.optionType === "put") return long ? "long-put" : "short-put";
  return long ? "long-call" : "short-call";
}

/**
 * Width of a vertical spread in currency: the strike distance, scaled by the
 * contract multiplier and the number of spreads held.
 */
function verticalWidth(long: Position, short: Position): Decimal | null {
  if (long.strike === undefined || short.strike === undefined) return null;
  if (long.optionType !== short.optionType) return null;

  const spreads = Math.min(Math.abs(long.quantity), Math.abs(short.quantity));
  if (spreads === 0) return null;

  return new Decimal(long.strike)
    .minus(short.strike)
    .abs()
    .times(contractMultiplier(long))
    .times(spreads);
}

function verticalOutcomes(
  legs: Position[],
  netCost: Money,
  currency: string,
): Pick<OptionGroup, "maxProfit" | "maxLoss" | "breakEven"> {
  const long = legs.find((l) => l.quantity > 0);
  const short = legs.find((l) => l.quantity < 0);
  if (!long || !short) {
    return { maxProfit: null, maxLoss: null, breakEven: null };
  }

  // Unequal legs are not a clean vertical, so no bounded outcome can be stated.
  if (Math.abs(long.quantity) !== Math.abs(short.quantity)) {
    return { maxProfit: null, maxLoss: null, breakEven: null };
  }

  const width = verticalWidth(long, short);
  if (!width) return { maxProfit: null, maxLoss: null, breakEven: null };

  const cost = netCost.amount;
  const contracts = new Decimal(Math.abs(long.quantity)).times(
    contractMultiplier(long),
  );

  // A debit spread risks what was paid and can earn the rest of the width.
  // A credit spread earns the credit and risks the width less that credit.
  const paidDebit = cost.greaterThan(0);
  const risk = paidDebit ? cost : width.plus(cost);
  const reward = paidDebit ? width.minus(cost) : cost.negated();

  const perUnit = cost.abs().dividedBy(contracts);
  const lowerStrike = Math.min(long.strike as number, short.strike as number);
  const upperStrike = Math.max(long.strike as number, short.strike as number);

  const breakEven =
    long.optionType === "put"
      ? new Decimal(upperStrike).minus(perUnit).toNumber()
      : new Decimal(lowerStrike).plus(perUnit).toNumber();

  return {
    maxProfit: money(reward, currency),
    maxLoss: money(risk.negated(), currency),
    breakEven,
  };
}

function singleLegOutcomes(
  leg: Position,
  netCost: Money,
  currency: string,
): Pick<OptionGroup, "maxProfit" | "maxLoss" | "breakEven"> {
  const strike = leg.strike;
  const contracts = new Decimal(Math.abs(leg.quantity)).times(
    contractMultiplier(leg),
  );
  const perUnit = contracts.isZero()
    ? new Decimal(0)
    : netCost.amount.abs().dividedBy(contracts);

  const breakEven =
    strike === undefined
      ? null
      : leg.optionType === "put"
        ? new Decimal(strike).minus(perUnit).toNumber()
        : new Decimal(strike).plus(perUnit).toNumber();

  const isLong = leg.quantity > 0;
  const isCall = leg.optionType !== "put";

  if (isLong) {
    // A long option can lose only the premium; a call's upside is unbounded.
    const maxLoss = money(netCost.amount.negated(), currency);
    if (isCall) return { maxProfit: null, maxLoss, breakEven };
    const floor = strike === undefined
      ? null
      : money(new Decimal(strike).times(contracts).minus(netCost.amount), currency);
    return { maxProfit: floor, maxLoss, breakEven };
  }

  // Short: premium received is the ceiling; an uncovered call is unbounded.
  const maxProfit = money(netCost.amount.negated(), currency);
  if (isCall) return { maxProfit, maxLoss: null, breakEven };
  const floor =
    strike === undefined
      ? null
      : money(
          new Decimal(strike).times(contracts).minus(netCost.amount.negated()).negated(),
          currency,
        );
  return { maxProfit, maxLoss: floor, breakEven };
}

function classify(legs: Position[]): OptionStrategy {
  if (legs.length === 1) return singleLegStrategy(legs[0]);

  if (legs.length === 2) {
    const [a, b] = legs;
    const opposite = Math.sign(a.quantity) !== Math.sign(b.quantity);
    if (opposite && a.optionType === b.optionType) {
      return a.optionType === "put" ? "put-spread" : "call-spread";
    }
  }

  return "complex";
}

/**
 * Collapses option legs sharing an underlying and expiry into one position, the
 * way a broker shows a spread. Reporting the legs separately overstates the
 * position: a $3.2k bull call spread appears as a $9.3k long call.
 */
export function groupOptions(positions: Position[]): {
  groups: OptionGroup[];
  nonOptions: Position[];
} {
  const options = positions.filter((p) => p.instrumentType === "option");
  const nonOptions = positions.filter((p) => p.instrumentType !== "option");

  const buckets = new Map<string, Position[]>();
  for (const option of options) {
    const key = groupKey(option);
    buckets.set(key, [...(buckets.get(key) ?? []), option]);
  }

  const groups: OptionGroup[] = [];

  for (const [key, legs] of buckets) {
    const currency = legs[0].currency;
    const sorted = [...legs].sort((a, b) => (b.strike ?? 0) - (a.strike ?? 0));

    const netCost = sum(sorted.map(costBasis), currency);
    const strategy = classify(sorted);

    const outcomes =
      sorted.length === 1
        ? singleLegOutcomes(sorted[0], netCost, currency)
        : strategy === "call-spread" || strategy === "put-spread"
          ? verticalOutcomes(sorted, netCost, currency)
          : { maxProfit: null, maxLoss: null, breakEven: null };

    groups.push({
      id: key,
      underlying: sorted[0].underlyingSymbol ?? sorted[0].symbol,
      expirationDate: sorted[0].expirationDate,
      strategy,
      legs: sorted,
      netCost,
      netMarketValue: sum(sorted.map(marketValue), currency),
      unrealizedPnL: sum(sorted.map(unrealizedPnL), currency),
      todayPnL: sum(sorted.map(todayPnL), currency),
      ...outcomes,
    });
  }

  groups.sort((a, b) =>
    b.netCost.amount.abs().comparedTo(a.netCost.amount.abs()),
  );

  return { groups, nonOptions };
}

/** Wire shape: Decimal is not JSON-safe, so amounts cross as strings. */
export type OptionGroupDTO = {
  id: string;
  underlying: string;
  expirationDate?: string;
  strategy: OptionStrategy;
  legs: Position[];
  netCost: MoneyDTO;
  netMarketValue: MoneyDTO;
  unrealizedPnL: MoneyDTO;
  todayPnL: MoneyDTO;
  maxProfit: MoneyDTO | null;
  maxLoss: MoneyDTO | null;
  breakEven: number | null;
  /**
   * Where the underlying share trades right now. Break-even is quoted as a
   * share price, so it is only readable beside the share price it is being
   * compared to.
   */
  underlyingPrice?: number;
  /**
   * What each leg cost per contract, keyed by its symbol. Derived here rather
   * than in the table because the broker's own average cost nets realized
   * proceeds into itself and can come back negative; `costBasis` already
   * handles that, and it is not worth repeating in the browser.
   */
  legCost: Record<string, number>;
  weightPercent: number;
};

export function toOptionGroupDTO(
  group: OptionGroup,
  investedTotal: Money,
  underlyingPrice?: number,
): OptionGroupDTO {
  return {
    underlyingPrice,
    legCost: Object.fromEntries(
      group.legs.map((leg) => {
        const units = contractMultiplier(leg).times(Math.abs(leg.quantity));
        if (units.isZero()) return [leg.symbol, 0];
        return [leg.symbol, costBasis(leg).amount.abs().dividedBy(units).toNumber()];
      }),
    ),
    id: group.id,
    underlying: group.underlying,
    expirationDate: group.expirationDate,
    strategy: group.strategy,
    legs: group.legs,
    netCost: toDTO(group.netCost),
    netMarketValue: toDTO(group.netMarketValue),
    unrealizedPnL: toDTO(group.unrealizedPnL),
    todayPnL: toDTO(group.todayPnL),
    maxProfit: group.maxProfit ? toDTO(group.maxProfit) : null,
    maxLoss: group.maxLoss ? toDTO(group.maxLoss) : null,
    breakEven: group.breakEven,
    weightPercent: investedTotal.amount.isZero()
      ? 0
      : group.netCost.amount
          .dividedBy(investedTotal.amount)
          .times(100)
          .toNumber(),
  };
}

/**
 * Composition by capital committed rather than current value. A spread counts
 * once at its net cost, so a $3.2k position stops presenting as a $9.3k one.
 */
export function allocationByInvestedCapital(
  positions: Position[],
  currency: string,
): AllocationSlice[] {
  const { groups, nonOptions } = groupOptions(positions);
  const entries: { key: string; label: string; value: Money }[] = [];

  for (const group of groups) {
    if (!group.netCost.amount.greaterThan(0)) continue;
    entries.push({
      key: group.id,
      label: `${group.underlying} ${group.strategy === "call-spread" ? "spread" : group.strategy === "put-spread" ? "spread" : "option"}`,
      value: group.netCost,
    });
  }

  for (const position of nonOptions) {
    const value =
      position.instrumentType === "cash"
        ? marketValue(position)
        : investedCapital(position, currency);
    if (!value.amount.greaterThan(0)) continue;
    entries.push({
      key: position.symbol,
      label: position.instrumentType === "cash" ? "Cash" : position.symbol,
      value,
    });
  }

  const total = entries.reduce((acc, entry) => add(acc, entry.value), zero(currency));
  if (total.amount.isZero()) return [];

  return entries
    .map((entry) => ({
      key: entry.key,
      label: entry.label,
      value: entry.value.amount.toFixed(),
      percent: entry.value.amount.dividedBy(total.amount).times(100).toNumber(),
    }))
    .sort((a, b) => Number(b.value) - Number(a.value));
}

/**
 * Composition by what each group cost, rather than what it is quoted at.
 *
 * Face value flatters options twice over. A long leg is quoted at the full
 * notional of the contract, and a spread's short leg is simply dropped, so
 * $3.2k of committed capital presented as $26k and the shares beside it
 * shrank to a rounding error. Netting each spread to its own cost puts the
 * slices back in proportion to the decisions behind them.
 *
 * Cash is the exception and is counted at face, because for cash those are
 * the same number.
 */
function costWeighted(
  positions: Position[],
  currency: string,
  keyOf: (subject: { position?: Position; group?: OptionGroup }) => {
    key: string;
    label: string;
  } | null,
): AllocationSlice[] {
  const { groups, nonOptions } = groupOptions(positions);
  const buckets = new Map<string, { label: string; value: Money }>();

  const put = (key: string, label: string, value: Money) => {
    if (!value.amount.greaterThan(0)) return;
    const existing = buckets.get(key);
    buckets.set(key, {
      label,
      value: existing ? add(existing.value, value) : value,
    });
  };

  for (const group of groups) {
    const bucket = keyOf({ group });
    if (bucket) put(bucket.key, bucket.label, group.netCost);
  }

  for (const position of nonOptions) {
    const bucket = keyOf({ position });
    if (!bucket) continue;
    put(
      bucket.key,
      bucket.label,
      position.instrumentType === "cash"
        ? marketValue(position)
        : investedCapital(position, currency),
    );
  }

  const total = [...buckets.values()].reduce(
    (acc, entry) => add(acc, entry.value),
    zero(currency),
  );
  if (total.amount.isZero()) return [];

  return [...buckets]
    .map(([key, entry]) => ({
      key,
      label: entry.label,
      value: entry.value.amount.toFixed(),
      percent: entry.value.amount.dividedBy(total.amount).times(100).toNumber(),
    }))
    .sort((a, b) => Number(b.value) - Number(a.value));
}

const COST_LABELS: Record<string, string> = {
  stock: "Stocks",
  etf: "ETFs",
  option: "Options",
  cash: "Cash",
};

export function allocationByAssetTypeAtCost(
  positions: Position[],
  currency: string,
): AllocationSlice[] {
  return costWeighted(positions, currency, ({ position, group }) => {
    if (group) return { key: "option", label: COST_LABELS.option };
    if (!position) return null;
    return {
      key: position.instrumentType,
      label: COST_LABELS[position.instrumentType] ?? position.instrumentType,
    };
  });
}

/**
 * Sector had the same distortion, and an option inherits its underlying's
 * sector — the exposure belongs to the company, not to the contract.
 */
export function allocationBySectorAtCost(
  positions: Position[],
  currency: string,
): AllocationSlice[] {
  const sectorOf = new Map<string, string>();
  for (const position of positions) {
    if (position.sector) sectorOf.set(position.symbol, position.sector);
    if (position.sector && position.underlyingSymbol) {
      sectorOf.set(position.underlyingSymbol, position.sector);
    }
  }
  if (sectorOf.size === 0) return [];

  return costWeighted(positions, currency, ({ position, group }) => {
    if (group) {
      const sector = sectorOf.get(group.underlying);
      return sector ? { key: sector, label: sector } : null;
    }
    if (!position || position.instrumentType === "cash") return null;
    const sector = sectorOf.get(position.symbol) ?? position.sector;
    return sector ? { key: sector, label: sector } : null;
  });
}

export type AssetClassPerformance = {
  key: "stocks" | "options";
  invested: MoneyDTO;
  marketValue: MoneyDTO;
  unrealizedPnL: MoneyDTO;
  /** Profit already taken in this class, replayed from the fills. */
  realizedPnL: MoneyDTO;
  /** Realized plus unrealized — the whole result, not just what is open. */
  totalPnL: MoneyDTO;
  /** Return on what is still held. */
  returnPercent: number | null;
  /** Return counting closed positions too. */
  totalReturnPercent: number | null;
};

/**
 * Stocks and options answer different questions, and netting them hides which
 * one is actually carrying the portfolio. Options are measured per spread so a
 * hedged position is not counted twice.
 */
/**
 * Stocks against options, counting everything each has done.
 *
 * Measuring only what is still open judges a class on the positions that
 * happened to survive: sell the winners and the class looks worse than it
 * was. Realized profit is replayed from the fills, which cover the account
 * from its first trade, and attributed to a class by whether the symbol is
 * an option contract.
 *
 * Realized is measured against capital still committed, which is the only
 * base available here. That overstates the percentage for a class that has
 * closed most of what it held, so the money figure is the honest one and
 * the percentage is a guide.
 */
export function performanceByAssetClass(
  positions: Position[],
  currency: string,
  realizedBySymbol: Record<string, number> = {},
): AssetClassPerformance[] {
  const { groups, nonOptions } = groupOptions(positions);
  const equities = nonOptions.filter((p) => p.instrumentType !== "cash");

  const stockInvested = equities
    .map((p) => investedCapital(p, currency))
    .reduce((acc, m) => add(acc, m), zero(currency));
  const stockValue = sum(equities.map(marketValue), currency);
  const stockPnL = sum(equities.map(unrealizedPnL), currency);

  const optionInvested = groups
    .map((g) => g.netCost)
    .filter((c) => c.amount.greaterThan(0))
    .reduce((acc, m) => add(acc, m), zero(currency));
  const optionValue = groups
    .map((g) => g.netMarketValue)
    .reduce((acc, m) => add(acc, m), zero(currency));
  const optionPnL = groups
    .map((g) => g.unrealizedPnL)
    .reduce((acc, m) => add(acc, m), zero(currency));

  // An option contract carries its terms in the symbol; anything else is a
  // share. Closed names are not in `positions` at all, which is exactly why
  // the fills have to be the source.
  let stockRealized = zero(currency);
  let optionRealized = zero(currency);
  for (const [symbol, amount] of Object.entries(realizedBySymbol)) {
    const value = money(amount, currency);
    if (parseSymbol(symbol).instrumentType === "option") {
      optionRealized = add(optionRealized, value);
    } else {
      stockRealized = add(stockRealized, value);
    }
  }

  const ratio = (pnl: Money, base: Money) =>
    base.amount.isZero() ? null : pnl.amount.dividedBy(base.amount).times(100).toNumber();

  const stockTotal = add(stockPnL, stockRealized);
  const optionTotal = add(optionPnL, optionRealized);

  return [
    {
      key: "stocks" as const,
      invested: toDTO(stockInvested),
      marketValue: toDTO(stockValue),
      unrealizedPnL: toDTO(stockPnL),
      realizedPnL: toDTO(stockRealized),
      totalPnL: toDTO(stockTotal),
      returnPercent: ratio(stockPnL, stockInvested),
      totalReturnPercent: ratio(stockTotal, stockInvested),
    },
    {
      key: "options" as const,
      invested: toDTO(optionInvested),
      marketValue: toDTO(optionValue),
      unrealizedPnL: toDTO(optionPnL),
      realizedPnL: toDTO(optionRealized),
      totalPnL: toDTO(optionTotal),
      returnPercent: ratio(optionPnL, optionInvested),
      totalReturnPercent: ratio(optionTotal, optionInvested),
    },
  ];
}

/** Capital committed to a position: what was paid, not what it is worth now. */
export function investedCapital(position: Position, currency: string): Money {
  if (position.instrumentType === "cash") return zero(currency);
  const cost = costBasis(position);
  return cost.amount.greaterThan(0) ? cost : zero(currency);
}

export function totalInvested(positions: Position[], currency: string): Money {
  const { groups, nonOptions } = groupOptions(positions);

  const fromOptions = groups
    .map((group) => group.netCost)
    .filter((cost) => cost.amount.greaterThan(0));

  const fromOthers = nonOptions
    .filter((p) => p.instrumentType !== "cash")
    .map((p) => investedCapital(p, currency));

  return [...fromOptions, ...fromOthers].reduce(
    (acc, item) => add(acc, item),
    zero(currency),
  );
}
