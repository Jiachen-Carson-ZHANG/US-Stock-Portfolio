import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import type { DB } from "@/lib/db";
import { parseSymbol } from "@/lib/moomoo/symbols";
import { marketDateString, marketSession, orderSessionDate } from "@/lib/market-hours";
import { mockState } from "@/lib/portfolio/mock";
import type { Portfolio } from "@/lib/portfolios";
import type { Quote } from "@/types/market";

export type OrderSide = "buy" | "sell";
export type OrderKind = "market" | "limit" | "stop";
export type TimeInForce = "day" | "gtc";
export type OrderStatus = "open" | "filled" | "cancelled" | "expired" | "rejected";

export type Order = {
  id: string;
  symbol: string;
  side: OrderSide;
  kind: OrderKind;
  quantity: number;
  limitPrice: number | null;
  stopPrice: number | null;
  timeInForce: TimeInForce;
  status: OrderStatus;
  fillPrice: number | null;
  filledAt: string | null;
  lastCheckedAt: string | null;
  note: string | null;
  placedAt: string;
};

type Row = {
  id: string;
  symbol: string;
  side: OrderSide;
  kind: OrderKind;
  quantity: number;
  limit_price: number | null;
  stop_price: number | null;
  time_in_force: TimeInForce;
  status: OrderStatus;
  fill_price: number | null;
  filled_at: string | null;
  last_checked_at: string | null;
  note: string | null;
  placed_at: string;
};

const toOrder = (row: Row): Order => ({
  id: row.id,
  symbol: row.symbol,
  side: row.side,
  kind: row.kind,
  quantity: Number(row.quantity),
  limitPrice: row.limit_price === null ? null : Number(row.limit_price),
  stopPrice: row.stop_price === null ? null : Number(row.stop_price),
  timeInForce: row.time_in_force,
  status: row.status,
  fillPrice: row.fill_price === null ? null : Number(row.fill_price),
  filledAt: row.filled_at,
  lastCheckedAt: row.last_checked_at,
  note: row.note,
  placedAt: row.placed_at,
});

const COLUMNS = `id, symbol, side, kind, quantity, limit_price, stop_price,
                 time_in_force, status, fill_price, filled_at, last_checked_at,
                 note, placed_at`;

export class OrderError extends Error {}

/** A quote older than this is not a price, it is a memory. */
export const MAX_QUOTE_AGE_MS = 15 * 60_000;

export function contractSize(symbol: string): number {
  return parseSymbol(symbol).instrumentType === "option" ? 100 : 1;
}

/**
 * What one order would cost or raise, at a given price.
 *
 * Options are quoted per share and trade in hundreds, which is the single
 * most common way a paper trading screen lies to somebody.
 */
export function orderValue(symbol: string, quantity: number, price: number): Decimal {
  return new Decimal(quantity).times(price).times(contractSize(symbol));
}

/**
 * Cash that is spoken for but not yet spent.
 *
 * Without this, ten open buy orders could each be validated against the same
 * balance and all fill, leaving the account overdrawn — the classic mistake
 * in a simulator, and the reason a real broker shows "buying power" rather
 * than "cash".
 */
export async function reservedCash(db: DB, portfolioId: string): Promise<Decimal> {
  const rows = await db.all<{
    symbol: string;
    quantity: number;
    limit_price: number | null;
    stop_price: number | null;
  }>(
    `SELECT symbol, quantity, limit_price, stop_price
       FROM orders
      WHERE portfolio_id = ? AND status = 'open' AND side = 'buy'`,
    [portfolioId],
  );

  return rows.reduce((total, row) => {
    // A market order that has not filled has no agreed price, so it cannot be
    // reserved against one. Only priced orders hold cash back, which is what
    // a broker does too.
    const price = row.limit_price ?? row.stop_price;
    if (price === null) return total;
    return total.plus(orderValue(row.symbol, Number(row.quantity), Number(price)));
  }, new Decimal(0));
}

export async function buyingPower(db: DB, portfolio: Portfolio): Promise<Decimal> {
  const { cash } = await mockState(db, portfolio);
  return cash.minus(await reservedCash(db, portfolio.id));
}

/** Shares already promised to an open sell order, so two cannot sell the same one. */
async function reservedShares(
  db: DB,
  portfolioId: string,
  symbol: string,
): Promise<Decimal> {
  const rows = await db.all<{ quantity: number }>(
    `SELECT quantity FROM orders
      WHERE portfolio_id = ? AND status = 'open' AND side = 'sell' AND symbol = ?`,
    [portfolioId, symbol],
  );
  return rows.reduce((total, row) => total.plus(row.quantity), new Decimal(0));
}

/**
 * Whether a price printed during the regular session that is open now.
 *
 * Only those may fill anything. Outside the session the feed's price is the
 * last close, not a price anybody can trade at: a buy sent at 4:53 in the
 * morning filled at the previous day's close while the stock was trading
 * about one percent higher, a profit that never existed. At a broker, market
 * and stop orders wait for the open; here every order does.
 *
 * The same test catches the first moments after the open, before a symbol
 * has traded: its price is still yesterday's until something prints today.
 */
function printedThisSession(quotedAt: number, now: Date): boolean {
  const at = new Date(quotedAt);
  return (
    marketSession(now) === "regular" &&
    marketSession(at) === "regular" &&
    marketDateString(at) === marketDateString(now)
  );
}

/**
 * A stop already past its trigger, explained, or null when it is not.
 *
 * A stop is a trigger for a move that has not happened yet: a buy stop above
 * the price, to buy a breakout; a sell stop below it, to cap a loss. One on
 * the wrong side would go off the moment it was placed, and nobody who
 * places one means that — "buy stop at 950" with the stock at 1,080 is
 * somebody who wanted to buy the dip, which is a limit order. Brokers refuse
 * it, and so does this.
 */
export function misplacedStop(
  symbol: string,
  side: OrderSide,
  stopPrice: number,
  price: number,
): string | null {
  const at = price.toFixed(2);
  const stop = stopPrice.toFixed(2);
  if (side === "buy" && price >= stopPrice) {
    return `A buy stop waits for the price to rise to it. ${symbol} is at ${at}, already above ${stop}, so it would buy at once. To buy if it falls to ${stop}, use a limit order.`;
  }
  if (side === "sell" && price <= stopPrice) {
    return `A sell stop waits for the price to fall to it. ${symbol} is at ${at}, already below ${stop}, so it would sell at once. To sell if it rises to ${stop}, use a limit order.`;
  }
  return null;
}

/**
 * Whether a resting order should fill at this price.
 *
 * Full fills only. Without an order book there is no honest way to decide
 * that half of an order filled, and inventing one would teach the wrong
 * lesson about liquidity.
 */
export function fillsAt(order: Order, price: number): boolean {
  if (order.kind === "market") return true;
  if (order.kind === "limit") {
    return order.side === "buy" ? price <= order.limitPrice! : price >= order.limitPrice!;
  }
  // A stop becomes a market order once the price trades through it.
  return order.side === "buy" ? price >= order.stopPrice! : price <= order.stopPrice!;
}

export type PlaceOrderInput = {
  symbol: string;
  side: OrderSide;
  kind: OrderKind;
  quantity: number;
  limitPrice?: number | null;
  stopPrice?: number | null;
  timeInForce?: TimeInForce;
};

export type PlaceResult = { order: Order; filled: boolean };

/**
 * Validates an order, then either fills it or leaves it resting.
 *
 * Every rule is enforced here rather than in the form, because a client that
 * posts directly has to meet the same ones or the leaderboard measures who
 * can use developer tools.
 */
export async function placeOrder(
  db: DB,
  portfolio: Portfolio,
  input: PlaceOrderInput,
  quote: Quote | undefined,
  placedBy: string | null,
  now: Date = new Date(),
): Promise<PlaceResult> {
  if (portfolio.kind !== "mock") {
    throw new OrderError("This portfolio follows a real brokerage account.");
  }
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new OrderError("Enter a whole number of shares.");
  }
  if (input.kind === "limit" && !(Number(input.limitPrice) > 0)) {
    throw new OrderError("A limit order needs a limit price.");
  }
  if (input.kind === "stop" && !(Number(input.stopPrice) > 0)) {
    throw new OrderError("A stop order needs a stop price.");
  }

  const symbol = input.symbol.toUpperCase();
  const timeInForce = input.timeInForce ?? "day";

  if (!quote || !Number.isFinite(quote.price) || quote.price <= 0) {
    throw new OrderError(`No usable price for ${symbol} right now.`);
  }
  const parsedAt = quote.dataTimestamp ? Date.parse(quote.dataTimestamp) : NaN;
  const quotedAt = Number.isFinite(parsedAt) ? parsedAt : now.getTime();
  // Only matters while an order can fill on the spot. Outside the session it
  // waits for a fresh price anyway, and a weekend quote is Friday's by nature.
  const regular = marketSession(now) === "regular";
  if (regular && now.getTime() - quotedAt > MAX_QUOTE_AGE_MS) {
    throw new OrderError("That price is more than fifteen minutes old. Try again shortly.");
  }
  if (input.kind === "stop") {
    const misplaced = misplacedStop(symbol, input.side, Number(input.stopPrice), quote.price);
    if (misplaced) throw new OrderError(misplaced);
  }

  const { holdings } = await mockState(db, portfolio);

  if (input.side === "sell") {
    const held = holdings.get(symbol)?.quantity ?? new Decimal(0);
    const promised = await reservedShares(db, portfolio.id, symbol);
    if (held.minus(promised).lessThan(input.quantity)) {
      throw new OrderError(
        `You hold ${held.toFixed(0)} of ${symbol}, with ${promised.toFixed(0)} already up for sale.`,
      );
    }
  } else {
    // Checked against the price the order could fill at: its limit if it has
    // one, otherwise the market. A market order costs what the market costs.
    const reference = input.kind === "market" ? quote.price : Number(input.limitPrice ?? input.stopPrice);
    const needed = orderValue(symbol, input.quantity, reference);
    const available = await buyingPower(db, portfolio);
    if (needed.greaterThan(available)) {
      throw new OrderError(
        `Not enough buying power: that needs ${needed.toFixed(2)} and you have ${available.toFixed(2)}.`,
      );
    }
  }

  const id = randomUUID();
  const marketable = printedThisSession(quotedAt, now) && fillsAt(
    {
      kind: input.kind,
      side: input.side,
      limitPrice: input.limitPrice ?? null,
      stopPrice: input.stopPrice ?? null,
    } as Order,
    quote.price,
  );

  await db.run(
    `INSERT INTO orders
       (id, portfolio_id, symbol, side, kind, quantity, limit_price, stop_price,
        time_in_force, status, last_checked_at, placed_by, placed_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)`,
    [
      id,
      portfolio.id,
      symbol,
      input.side,
      input.kind,
      input.quantity,
      input.limitPrice ?? null,
      input.stopPrice ?? null,
      timeInForce,
      now.toISOString(),
      placedBy,
      now.toISOString(),
      now.toISOString(),
    ],
  );

  if (marketable) {
    await fill(db, portfolio.id, id, symbol, input.side, input.quantity, quote, now);
  }

  const order = await findOrder(db, portfolio.id, id);
  if (!order) throw new OrderError("The order was not recorded.");
  return { order, filled: order.status === "filled" };
}

/**
 * Records a fill: a transaction, and the order marked done.
 *
 * The fill lands in the same transactions table the broker sync writes to, so
 * the holdings table, the performance chart, the reconstruction and the Arena
 * all treat it exactly as they treat a real trade.
 */
async function fill(
  db: DB,
  portfolioId: string,
  orderId: string,
  symbol: string,
  side: OrderSide,
  quantity: number,
  quote: Quote,
  now: Date,
): Promise<void> {
  // A limit order that was marketable when placed fills at the market price,
  // not at its limit — a better price than asked for is kept by the trader,
  // which is how a real fill works.
  const price = quote.price;
  const value = orderValue(symbol, quantity, price);

  await db.transaction(async (tx) => {
    await tx.run(
      `INSERT INTO transactions
         (deal_id, order_id, side, symbol, name, quantity, price, amount, traded_at, synced_at, portfolio_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        `mock-${orderId}`,
        orderId,
        side,
        symbol,
        quote.name ?? null,
        quantity,
        price,
        side === "buy" ? value.negated().toNumber() : value.toNumber(),
        now.toISOString(),
        now.toISOString(),
        portfolioId,
      ],
    );
    await tx.run(
      `UPDATE orders
          SET status = 'filled', fill_price = ?, filled_at = ?, last_checked_at = ?, updated_at = ?
        WHERE id = ? AND status = 'open'`,
      [price, now.toISOString(), now.toISOString(), now.toISOString(), orderId],
    );
  });
}

export async function findOrder(
  db: DB,
  portfolioId: string,
  id: string,
): Promise<Order | null> {
  const row = await db.get<Row>(
    `SELECT ${COLUMNS} FROM orders WHERE id = ? AND portfolio_id = ?`,
    [id, portfolioId],
  );
  return row ? toOrder(row) : null;
}

export async function openOrders(db: DB, portfolioId: string): Promise<Order[]> {
  const rows = await db.all<Row>(
    `SELECT ${COLUMNS} FROM orders
      WHERE portfolio_id = ? AND status = 'open' ORDER BY placed_at DESC`,
    [portfolioId],
  );
  return rows.map(toOrder);
}

export async function recentOrders(
  db: DB,
  portfolioId: string,
  limit = 50,
): Promise<Order[]> {
  const rows = await db.all<Row>(
    `SELECT ${COLUMNS} FROM orders
      WHERE portfolio_id = ? ORDER BY placed_at DESC LIMIT ?`,
    [portfolioId, limit],
  );
  return rows.map(toOrder);
}

export async function cancelOrder(
  db: DB,
  portfolioId: string,
  id: string,
  now: Date = new Date(),
): Promise<boolean> {
  const result = await db.run(
    `UPDATE orders SET status = 'cancelled', updated_at = ?
      WHERE id = ? AND portfolio_id = ? AND status = 'open'`,
    [now.toISOString(), id, portfolioId],
  );
  return result.changes > 0;
}

/**
 * Looks at every resting order and fills what the market has reached.
 *
 * Called whenever quotes are refreshed for a mock portfolio, and by the daily
 * job. There is no always-on worker, so an order is checked when somebody is
 * looking — which is why last_checked_at is recorded and shown rather than
 * implying continuous monitoring.
 */
export async function matchOpenOrders(
  db: DB,
  portfolio: Portfolio,
  quotes: Map<string, Quote>,
  now: Date = new Date(),
): Promise<{ filled: number; expired: number }> {
  const resting = await openOrders(db, portfolio.id);
  if (resting.length === 0) return { filled: 0, expired: 0 };

  let filled = 0;
  let expired = 0;

  const session = orderSessionDate(now);

  for (const order of resting) {
    // A day order dies when the session it was placed for closes, whether or
    // not anybody was watching. That session is the market's, not UTC's:
    // an order sent at 9pm New York is for tomorrow's session, though UTC
    // has long since turned over — and one sent on a Saturday is for Monday.
    if (
      order.timeInForce === "day" &&
      orderSessionDate(new Date(order.placedAt)) < session
    ) {
      await db.run(
        `UPDATE orders SET status = 'expired', last_checked_at = ?, updated_at = ?
          WHERE id = ? AND status = 'open'`,
        [now.toISOString(), now.toISOString(), order.id],
      );
      expired += 1;
      continue;
    }

    const quote = quotes.get(order.symbol);
    if (!quote || !Number.isFinite(quote.price) || quote.price <= 0) continue;

    // Three fairness rules, all about *which* price is allowed to fill an order.
    //
    // A price has to be recent. Left out, a limit order resting over a long
    // weekend fills on Friday's last print as if it were live.
    //
    // And a price has to have printed after the order existed. Quotes are
    // cached for a few seconds, so without this an order placed at 10:00:04
    // could fill on the 10:00:00 tick — buying at a price it already knew it
    // had missed. Anyone watching the number before clicking would win every
    // time, which is the opposite of a fair fill.
    //
    // And a price has to come from the regular session that is open now —
    // see printedThisSession for the fill that taught us that.
    const quotedAt = quote.dataTimestamp ? Date.parse(quote.dataTimestamp) : NaN;
    if (Number.isFinite(quotedAt)) {
      if (now.getTime() - quotedAt > MAX_QUOTE_AGE_MS) continue;
      const placedAt = Date.parse(order.placedAt);
      if (Number.isFinite(placedAt) && quotedAt < placedAt) continue;
    }
    if (!printedThisSession(Number.isFinite(quotedAt) ? quotedAt : now.getTime(), now)) continue;

    await db.run(`UPDATE orders SET last_checked_at = ? WHERE id = ?`, [
      now.toISOString(),
      order.id,
    ]);

    if (!fillsAt(order, quote.price)) continue;

    // Re-checked at fill time, not only at placement: cash may have gone on
    // something else since, and a resting order must not overdraw the
    // account just because it was affordable yesterday.
    if (order.side === "buy") {
      const { cash } = await mockState(db, portfolio);
      if (orderValue(order.symbol, order.quantity, quote.price).greaterThan(cash)) {
        await db.run(
          `UPDATE orders SET status = 'rejected', note = ?, last_checked_at = ?, updated_at = ?
            WHERE id = ? AND status = 'open'`,
          [
            "Not enough cash when the price was reached.",
            now.toISOString(),
            now.toISOString(),
            order.id,
          ],
        );
        continue;
      }
    } else {
      const { holdings } = await mockState(db, portfolio);
      const held = holdings.get(order.symbol)?.quantity ?? new Decimal(0);
      if (held.lessThan(order.quantity)) {
        await db.run(
          `UPDATE orders SET status = 'rejected', note = ?, last_checked_at = ?, updated_at = ?
            WHERE id = ? AND status = 'open'`,
          [
            "No longer holding enough when the price was reached.",
            now.toISOString(),
            now.toISOString(),
            order.id,
          ],
        );
        continue;
      }
    }

    await fill(db, portfolio.id, order.id, order.symbol, order.side, order.quantity, quote, now);
    filled += 1;
  }

  return { filled, expired };
}
