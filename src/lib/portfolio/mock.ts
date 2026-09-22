import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import type { DB } from "@/lib/db";
import { parseSymbol } from "@/lib/moomoo/symbols";
import type { Portfolio } from "@/lib/portfolios";
import type { Quote } from "@/types/market";
import { readTransactions } from "./transactions";

function multiplierFor(symbol: string): number {
  return parseSymbol(symbol).instrumentType === "option" ? 100 : 1;
}

/**
 * Cash and holdings implied by a mock portfolio's own trades.
 *
 * A mock portfolio has no broker to ask, so its state is always the replay
 * of what it has done since its opening balance. That keeps it honest: there
 * is no separate balance to drift out of step with the trade list.
 */
export async function mockState(
  db: DB,
  portfolio: Portfolio,
): Promise<{ cash: Decimal; holdings: Map<string, { quantity: Decimal; cost: Decimal }> }> {
  const opening = new Decimal(portfolio.openingCash ?? "0");
  const fills = (await readTransactions(db, portfolio.id, 5000)).slice().reverse();

  let cash = opening;
  const holdings = new Map<string, { quantity: Decimal; cost: Decimal }>();

  for (const fill of fills) {
    const multiplier = multiplierFor(fill.symbol);
    const signed = new Decimal(fill.quantity).times(fill.side === "buy" ? 1 : -1);
    const gross = signed.times(fill.price).times(multiplier);
    cash = cash.minus(gross);

    const lot = holdings.get(fill.symbol) ?? {
      quantity: new Decimal(0),
      cost: new Decimal(0),
    };

    if (lot.quantity.isZero() || lot.quantity.isNegative() === signed.isNegative()) {
      lot.quantity = lot.quantity.plus(signed);
      lot.cost = lot.cost.plus(gross);
    } else {
      const closed = Decimal.min(signed.abs(), lot.quantity.abs());
      const direction = lot.quantity.isNegative() ? -1 : 1;
      const closedCost = lot.cost.dividedBy(lot.quantity).times(closed).times(direction);
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
    holdings.set(fill.symbol, lot);
  }

  return { cash, holdings };
}


/**
 * Writes a mock portfolio's holdings into `positions`.
 *
 * Deliberately the same table the broker sync writes to, so the holdings
 * table, the allocation donut, the reconstruction, the performance chart and
 * the AI context all work on a mock portfolio without knowing it is one.
 * That is the whole reason to model it this way rather than build a
 * separate game.
 */
export async function syncMockPositions(
  db: DB,
  portfolio: Portfolio,
  quotes: Map<string, Quote>,
  now: Date = new Date(),
): Promise<number> {
  const { cash, holdings } = await mockState(db, portfolio);
  const syncedAt = now.toISOString();
  const currency = portfolio.baseCurrency;

  const rows: unknown[][] = [];

  for (const [symbol, lot] of holdings) {
    if (lot.quantity.isZero()) continue;
    const parsed = parseSymbol(symbol);
    const quote = quotes.get(symbol);
    const multiplier = multiplierFor(symbol);
    const price = quote?.price;
    const marketValue =
      price === undefined
        ? null
        : lot.quantity.times(price).times(multiplier).toNumber();

    rows.push([
      randomUUID(),
      "mock",
      parsed.instrumentType,
      symbol,
      parsed.underlyingSymbol ?? null,
      quote?.name ?? null,
      null,
      lot.quantity.toNumber(),
      lot.cost.dividedBy(lot.quantity).dividedBy(multiplier).toNumber(),
      currency,
      parsed.optionType ?? null,
      parsed.strike ?? null,
      parsed.expirationDate ?? null,
      multiplier,
      price ?? null,
      marketValue,
      marketValue === null ? null : marketValue - lot.cost.toNumber(),
      null,
      null,
      syncedAt,
      portfolio.id,
    ]);
  }

  rows.push([
    randomUUID(),
    "mock",
    "cash",
    currency,
    null,
    "Cash",
    null,
    cash.toNumber(),
    null,
    currency,
    null,
    null,
    null,
    null,
    null,
    cash.toNumber(),
    null,
    null,
    null,
    syncedAt,
    portfolio.id,
  ]);

  await db.transaction(async (tx) => {
    // The same race as the broker sync, and the same fix: DELETE cannot see
    // another transaction's uncommitted inserts, so two overlapping refreshes
    // each delete what they can see and then append a full set. Locking the
    // parent row serializes them, and works even when there is nothing to
    // delete yet.
    await tx.get(`SELECT id FROM portfolios WHERE id = ? FOR UPDATE`, [portfolio.id]);
    await tx.run(`DELETE FROM positions WHERE portfolio_id = ?`, [portfolio.id]);
    for (const row of rows) {
      await tx.run(
        `INSERT INTO positions
           (id, broker, instrument_type, symbol, underlying_symbol, name, sector,
            quantity, average_cost, currency, option_type, strike, expiration_date,
            contract_multiplier, reported_price, reported_market_value,
            reported_unrealized_pnl, reported_today_pnl, reported_realized_pnl,
            synced_at, portfolio_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        row,
      );
    }
  });

  return rows.length;
}
