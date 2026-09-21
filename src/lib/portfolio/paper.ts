import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import type { DB } from "@/lib/db";
import { parseSymbol } from "@/lib/moomoo/symbols";
import type { Portfolio } from "@/lib/portfolios";
import type { Quote } from "@/types/market";
import { readTransactions } from "./transactions";

/** A fill priced from a quote older than this is not a game, it is a cheat. */
export const MAX_QUOTE_AGE_MS = 15 * 60_000;

export type PaperTrade = {
  side: "buy" | "sell";
  symbol: string;
  quantity: number;
};

export class PaperTradeError extends Error {}

function multiplierFor(symbol: string): number {
  return parseSymbol(symbol).instrumentType === "option" ? 100 : 1;
}

/**
 * Cash and holdings implied by a paper portfolio's own trades.
 *
 * A paper portfolio has no broker to ask, so its state is always the replay
 * of what it has done since its opening balance. That keeps it honest: there
 * is no separate balance to drift out of step with the trade list.
 */
export async function paperState(
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
 * Validates and records one paper trade.
 *
 * Every rule here is server-side. A client that skips the form and posts
 * directly must hit exactly the same checks, or the leaderboard measures who
 * can use developer tools rather than who can invest.
 *
 * Short selling is not allowed: it is the one position whose loss is not
 * bounded by the opening balance, which makes the ranking meaningless.
 */
export async function placePaperTrade(
  db: DB,
  portfolio: Portfolio,
  trade: PaperTrade,
  quote: Quote | undefined,
  now: Date = new Date(),
): Promise<{ price: number; cash: string }> {
  if (portfolio.kind !== "paper") {
    throw new PaperTradeError("This portfolio follows a real brokerage account.");
  }
  if (!Number.isInteger(trade.quantity) || trade.quantity <= 0) {
    throw new PaperTradeError("Enter a whole number of shares.");
  }
  if (!quote || !Number.isFinite(quote.price) || quote.price <= 0) {
    throw new PaperTradeError(`No usable price for ${trade.symbol} right now.`);
  }

  const quotedAt = quote.dataTimestamp
    ? new Date(quote.dataTimestamp).getTime()
    : now.getTime();
  if (now.getTime() - quotedAt > MAX_QUOTE_AGE_MS) {
    throw new PaperTradeError(
      "That price is more than fifteen minutes old. Try again in a moment.",
    );
  }

  const { cash, holdings } = await paperState(db, portfolio);
  const multiplier = multiplierFor(trade.symbol);
  const value = new Decimal(trade.quantity).times(quote.price).times(multiplier);

  if (trade.side === "buy") {
    if (value.greaterThan(cash)) {
      throw new PaperTradeError(
        `Not enough cash: that costs ${value.toFixed(2)} and you have ${cash.toFixed(2)}.`,
      );
    }
  } else {
    const held = holdings.get(trade.symbol)?.quantity ?? new Decimal(0);
    if (held.lessThan(trade.quantity)) {
      throw new PaperTradeError(
        `You hold ${held.toFixed(0)} of ${trade.symbol}, so you cannot sell ${trade.quantity}.`,
      );
    }
  }

  const amount = trade.side === "buy" ? value.negated() : value;
  await db.run(
    `INSERT INTO transactions
       (deal_id, order_id, side, symbol, name, quantity, price, amount, traded_at, synced_at, portfolio_id)
     VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      `paper-${randomUUID()}`,
      trade.side,
      trade.symbol,
      quote.name ?? null,
      trade.quantity,
      quote.price,
      amount.toNumber(),
      now.toISOString(),
      now.toISOString(),
      portfolio.id,
    ],
  );

  const after = await paperState(db, portfolio);
  return { price: quote.price, cash: after.cash.toFixed(2) };
}

/**
 * Writes a paper portfolio's holdings into `positions`.
 *
 * Deliberately the same table the broker sync writes to, so the holdings
 * table, the allocation donut, the reconstruction, the performance chart and
 * the AI context all work on a paper portfolio without knowing it is one.
 * That is the whole reason to model it this way rather than build a
 * separate game.
 */
export async function syncPaperPositions(
  db: DB,
  portfolio: Portfolio,
  quotes: Map<string, Quote>,
  now: Date = new Date(),
): Promise<number> {
  const { cash, holdings } = await paperState(db, portfolio);
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
      "paper",
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
    "paper",
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
