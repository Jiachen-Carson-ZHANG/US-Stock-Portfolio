import Decimal from "decimal.js";
import type { AllocationSlice, Money, Position } from "@/types/portfolio";
import { add, money, sum, zero } from "@/lib/money";
import { contractMultiplier, costBasis, marketValue, todayPnL, unrealizedPnL } from ".";

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

export function optionStrategyLabel(strategy: OptionStrategy): string {
  return strategy;
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
