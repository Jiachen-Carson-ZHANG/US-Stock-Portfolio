import Decimal from "decimal.js";
import type { BrokerTransaction } from "@/types/broker";

export type CashFlow = { date: string; amount: number };
export type PriceSeries = Map<string, Map<string, number>>;

export type ReconstructedDay = {
  date: string;
  marketValue: Decimal;
  cash: Decimal;
  costBasis: Decimal;
  unrealized: Decimal;
  realized: Decimal;
  netDeposits: Decimal;
  totalReturn: Decimal;
};

type Lot = { quantity: Decimal; cost: Decimal };

/** Options are quoted per share but trade in hundreds. */
function multiplierFor(symbol: string): number {
  return /\d{6}[CP]\d{8}$/.test(symbol) ? 100 : 1;
}

/**
 * Replays the account forward from its first trade, one day at a time.
 *
 * Average-cost accounting throughout, which is what the broker reports against
 * and therefore what reconciles with it. A trade that reduces a position
 * realizes the difference between proceeds and the average cost of the part
 * closed; a trade that extends one only moves cost. Short positions carry a
 * negative quantity and a negative cost — the credit received — so buying one
 * back realizes in exactly the same way without a separate branch.
 *
 * Cash is carried forward rather than derived, so it absorbs deposits and
 * trades in the order they actually happened. A deposit landing mid-period is
 * therefore never mistaken for a gain: it lifts cash and net deposits by the
 * same amount, leaving total return untouched on the day.
 */
export function reconstruct(
  fills: BrokerTransaction[],
  deposits: CashFlow[],
  prices: PriceSeries,
  dates: string[],
): ReconstructedDay[] {
  const byDate = new Map<string, BrokerTransaction[]>();
  for (const fill of fills) {
    const day = fill.tradedAt.slice(0, 10);
    const bucket = byDate.get(day);
    if (bucket) bucket.push(fill);
    else byDate.set(day, [fill]);
  }

  /**
   * A deposit lands on whatever day the bank moved it, which may be a weekend
   * or a holiday — one of Carson's arrived on a Saturday. Keying by exact date
   * would drop it, because only dates in the series are ever visited, and
   * adding that Saturday to the series instead breaks the weekday run the
   * daily statistics require. So each flow is carried to the first day of the
   * series on or after it, which is also when the money could first be used.
   */
  const depositsByDate = new Map<string, Decimal>();
  const ordered = [...dates].sort();
  for (const flow of deposits) {
    const landing = ordered.find((date) => date >= flow.date) ?? ordered[ordered.length - 1];
    if (landing === undefined) continue;
    depositsByDate.set(
      landing,
      (depositsByDate.get(landing) ?? new Decimal(0)).plus(flow.amount),
    );
  }

  const lots = new Map<string, Lot>();
  const lastClose = new Map<string, number>();
  let cash = new Decimal(0);
  let realized = new Decimal(0);
  let netDeposits = new Decimal(0);
  const days: ReconstructedDay[] = [];

  for (const date of dates) {
    netDeposits = netDeposits.plus(depositsByDate.get(date) ?? 0);
    cash = cash.plus(depositsByDate.get(date) ?? 0);

    for (const fill of byDate.get(date) ?? []) {
      const multiplier = multiplierFor(fill.symbol);
      const signed = new Decimal(fill.quantity).times(fill.side === "buy" ? 1 : -1);
      const gross = signed.times(fill.price).times(multiplier);
      cash = cash.minus(gross);

      const lot = lots.get(fill.symbol) ?? { quantity: new Decimal(0), cost: new Decimal(0) };
      const extending =
        lot.quantity.isZero() || lot.quantity.isNegative() === signed.isNegative();

      if (extending) {
        lot.quantity = lot.quantity.plus(signed);
        lot.cost = lot.cost.plus(gross);
      } else {
        // Only the overlap closes; anything past it opens the other way.
        const closed = Decimal.min(signed.abs(), lot.quantity.abs());
        const direction = lot.quantity.isNegative() ? -1 : 1;
        // cost/quantity is the average per unit and stays positive for a short,
        // whose quantity and credit are both negative.
        const averageCost = lot.cost.dividedBy(lot.quantity);
        const closedCost = averageCost.times(closed).times(direction);
        // Selling a long brings cash in, buying back a short pays it out.
        const closedCash = closed.times(fill.price).times(multiplier).times(direction);

        realized = realized.plus(closedCash.minus(closedCost));
        lot.quantity = lot.quantity.minus(closed.times(direction));
        lot.cost = lot.cost.minus(closedCost);

        const remainder = signed.abs().minus(closed);
        if (remainder.greaterThan(0)) {
          const opened = signed.isNegative() ? remainder.negated() : remainder;
          lot.quantity = lot.quantity.plus(opened);
          lot.cost = lot.cost.plus(opened.times(fill.price).times(multiplier));
        }
      }

      if (lot.quantity.isZero()) lot.cost = new Decimal(0);
      lots.set(fill.symbol, lot);
    }

    let marketValue = new Decimal(0);
    let costBasis = new Decimal(0);
    for (const [symbol, lot] of lots) {
      if (lot.quantity.isZero()) continue;
      // A holiday or a halt leaves no close, so the last one stands rather
      // than valuing the position at zero for a day.
      const close = prices.get(symbol)?.get(date) ?? lastClose.get(symbol);
      if (close === undefined) continue;
      lastClose.set(symbol, close);
      marketValue = marketValue.plus(
        lot.quantity.times(close).times(multiplierFor(symbol)),
      );
      costBasis = costBasis.plus(lot.cost);
    }

    const value = marketValue.plus(cash);
    days.push({
      date,
      marketValue: value,
      cash,
      costBasis,
      unrealized: marketValue.minus(costBasis),
      realized,
      netDeposits,
      totalReturn: value.minus(netDeposits),
    });
  }

  return days;
}
