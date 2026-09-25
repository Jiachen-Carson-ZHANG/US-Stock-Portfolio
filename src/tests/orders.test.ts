import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, TEST_PORTFOLIO_ID, type TestDb } from "@/lib/db/testing";
import {
  OrderError,
  buyingPower,
  cancelOrder,
  fillsAt,
  matchOpenOrders,
  openOrders,
  orderValue,
  placeOrder,
  type Order,
} from "@/lib/trading/orders";
import { mockState } from "@/lib/portfolio/mock";
import type { Portfolio } from "@/lib/portfolios";
import type { Quote } from "@/types/market";

let db: TestDb;
const NOW = new Date("2026-09-22T14:00:00.000Z");

const portfolio: Portfolio = {
  id: TEST_PORTFOLIO_ID,
  slug: "jane-mock",
  displayName: "Jane",
  ownerUserId: null,
  kind: "mock",
  baseCurrency: "USD",
  openingCash: "10000",
  createdAt: NOW.toISOString(),
};

function quote(symbol: string, price: number, ageMs = 0): Quote {
  return {
    symbol,
    name: symbol,
    price,
    previousClose: price,
    change: 0,
    changePercent: 0,
    marketStatus: "regular",
    dataTimestamp: new Date(NOW.getTime() - ageMs).toISOString(),
    source: "test",
  };
}

beforeEach(async () => {
  db = await createTestDb();
  await db.run(`UPDATE portfolios SET kind = 'mock', opening_cash = '10000' WHERE id = ?`, [
    TEST_PORTFOLIO_ID,
  ]);
});

afterEach(async () => {
  await db.close();
});

describe("placing an order", () => {
  it("fills a market order straight away", async () => {
    const result = await placeOrder(
      db,
      portfolio,
      { symbol: "NVDA", side: "buy", kind: "market", quantity: 10 },
      quote("NVDA", 200),
      null,
      NOW,
    );

    expect(result.filled).toBe(true);
    expect(result.order.fillPrice).toBe(200);
    expect((await mockState(db, portfolio)).cash.toFixed(2)).toBe("8000.00");
  });

  it("rests a limit buy that is above the market", async () => {
    const result = await placeOrder(
      db,
      portfolio,
      { symbol: "NVDA", side: "buy", kind: "limit", quantity: 10, limitPrice: 180 },
      quote("NVDA", 200),
      null,
      NOW,
    );

    expect(result.filled).toBe(false);
    expect(result.order.status).toBe("open");
    // Nothing spent yet.
    expect((await mockState(db, portfolio)).cash.toFixed(2)).toBe("10000.00");
  });

  // A better price than you asked for belongs to you, which is how a real
  // fill works.
  it("fills a marketable limit at the market price, not the limit", async () => {
    const result = await placeOrder(
      db,
      portfolio,
      { symbol: "NVDA", side: "buy", kind: "limit", quantity: 10, limitPrice: 220 },
      quote("NVDA", 200),
      null,
      NOW,
    );

    expect(result.filled).toBe(true);
    expect(result.order.fillPrice).toBe(200);
  });

  it("refuses an order the account cannot afford", async () => {
    await expect(
      placeOrder(
        db,
        portfolio,
        { symbol: "NVDA", side: "buy", kind: "market", quantity: 100 },
        quote("NVDA", 200),
        null,
        NOW,
      ),
    ).rejects.toBeInstanceOf(OrderError);
  });

  it("refuses to sell shares that are not held", async () => {
    await expect(
      placeOrder(
        db,
        portfolio,
        { symbol: "NVDA", side: "sell", kind: "market", quantity: 1 },
        quote("NVDA", 200),
        null,
        NOW,
      ),
    ).rejects.toThrow(/hold/);
  });

  it("refuses a stale price", async () => {
    await expect(
      placeOrder(
        db,
        portfolio,
        { symbol: "NVDA", side: "buy", kind: "market", quantity: 1 },
        quote("NVDA", 200, 20 * 60_000),
        null,
        NOW,
      ),
    ).rejects.toThrow(/fifteen minutes/);
  });

  it("insists a limit order carries a limit", async () => {
    await expect(
      placeOrder(
        db,
        portfolio,
        { symbol: "NVDA", side: "buy", kind: "limit", quantity: 1 },
        quote("NVDA", 200),
        null,
        NOW,
      ),
    ).rejects.toThrow(/limit price/);
  });

  it("prices an option contract at a hundred shares", () => {
    expect(orderValue("NVDA270115C00200000", 1, 20).toNumber()).toBe(2_000);
    expect(orderValue("NVDA", 1, 20).toNumber()).toBe(20);
  });
});

describe("buying power", () => {
  // The classic simulator bug: ten orders each validated against the same
  // balance, all filling, account overdrawn.
  it("holds back cash for resting buy orders", async () => {
    await placeOrder(
      db,
      portfolio,
      { symbol: "NVDA", side: "buy", kind: "limit", quantity: 20, limitPrice: 400 },
      quote("NVDA", 500),
      null,
      NOW,
    );

    expect((await mockState(db, portfolio)).cash.toFixed(2)).toBe("10000.00");
    expect((await buyingPower(db, portfolio)).toFixed(2)).toBe("2000.00");

    await expect(
      placeOrder(
        db,
        portfolio,
        { symbol: "AAPL", side: "buy", kind: "limit", quantity: 20, limitPrice: 400 },
        quote("AAPL", 500),
        null,
        NOW,
      ),
    ).rejects.toThrow(/buying power/);
  });

  it("releases the cash when the order is cancelled", async () => {
    const { order } = await placeOrder(
      db,
      portfolio,
      { symbol: "NVDA", side: "buy", kind: "limit", quantity: 20, limitPrice: 400 },
      quote("NVDA", 500),
      null,
      NOW,
    );

    expect(await cancelOrder(db, portfolio.id, order.id, NOW)).toBe(true);
    expect((await buyingPower(db, portfolio)).toFixed(2)).toBe("10000.00");
  });

  it("will not let two sell orders promise the same shares", async () => {
    await placeOrder(
      db,
      portfolio,
      { symbol: "NVDA", side: "buy", kind: "market", quantity: 10 },
      quote("NVDA", 200),
      null,
      NOW,
    );
    await placeOrder(
      db,
      portfolio,
      { symbol: "NVDA", side: "sell", kind: "limit", quantity: 8, limitPrice: 300 },
      quote("NVDA", 200),
      null,
      NOW,
    );

    await expect(
      placeOrder(
        db,
        portfolio,
        { symbol: "NVDA", side: "sell", kind: "limit", quantity: 5, limitPrice: 300 },
        quote("NVDA", 200),
        null,
        NOW,
      ),
    ).rejects.toThrow(/already up for sale/);
  });
});

describe("when a resting order fills", () => {
  it("triggers once the price comes to it", async () => {
    await placeOrder(
      db,
      portfolio,
      { symbol: "NVDA", side: "buy", kind: "limit", quantity: 10, limitPrice: 180 },
      quote("NVDA", 200),
      null,
      NOW,
    );

    const still = await matchOpenOrders(db, portfolio, new Map([["NVDA", quote("NVDA", 190)]]), NOW);
    expect(still.filled).toBe(0);

    const done = await matchOpenOrders(db, portfolio, new Map([["NVDA", quote("NVDA", 175)]]), NOW);
    expect(done.filled).toBe(1);
    // Filled at the market, which is better than the limit asked for.
    expect((await mockState(db, portfolio)).cash.toFixed(2)).toBe("8250.00");
  });

  it("records when it last looked, rather than implying it never stops", async () => {
    await placeOrder(
      db,
      portfolio,
      { symbol: "NVDA", side: "buy", kind: "limit", quantity: 1, limitPrice: 100 },
      quote("NVDA", 200),
      null,
      NOW,
    );

    const later = new Date(NOW.getTime() + 60_000);
    await matchOpenOrders(db, portfolio, new Map([["NVDA", quote("NVDA", 200)]]), later);

    expect((await openOrders(db, portfolio.id))[0].lastCheckedAt).toBe(later.toISOString());
  });

  it("expires a day order the following day", async () => {
    await placeOrder(
      db,
      portfolio,
      { symbol: "NVDA", side: "buy", kind: "limit", quantity: 1, limitPrice: 100, timeInForce: "day" },
      quote("NVDA", 200),
      null,
      NOW,
    );

    const tomorrow = new Date("2026-09-23T14:00:00.000Z");
    const result = await matchOpenOrders(db, portfolio, new Map(), tomorrow);

    expect(result.expired).toBe(1);
    expect(await openOrders(db, portfolio.id)).toHaveLength(0);
  });

  it("leaves a good-till-cancelled order alone", async () => {
    await placeOrder(
      db,
      portfolio,
      { symbol: "NVDA", side: "buy", kind: "limit", quantity: 1, limitPrice: 100, timeInForce: "gtc" },
      quote("NVDA", 200),
      null,
      NOW,
    );

    const tomorrow = new Date("2026-09-23T14:00:00.000Z");
    await matchOpenOrders(db, portfolio, new Map(), tomorrow);
    expect(await openOrders(db, portfolio.id)).toHaveLength(1);
  });

  /**
   * A limit buy can never surprise the account: it is reserved at its limit
   * and can only fill at or below it. A stop buy can, because a stop becomes
   * a market order once triggered, and the market may have gapped well past
   * the stop. The reservation is an estimate there, so the balance is
   * re-checked at fill time rather than trusted from placement.
   */
  it("refuses a triggered stop the account can no longer afford", async () => {
    await placeOrder(
      db,
      portfolio,
      { symbol: "NVDA", side: "buy", kind: "stop", quantity: 20, stopPrice: 400, timeInForce: "gtc" },
      quote("NVDA", 300),
      null,
      NOW,
    );

    // It gaps far above the stop overnight: 20 x 600 is 12,000 on a 10,000
    // account.
    const result = await matchOpenOrders(
      db,
      portfolio,
      new Map([["NVDA", quote("NVDA", 600)]]),
      NOW,
    );

    expect(result.filled).toBe(0);
    expect(await openOrders(db, portfolio.id)).toHaveLength(0);
    expect((await mockState(db, portfolio)).cash.toFixed(2)).toBe("10000.00");
  });

  it("still fills a triggered stop the account can afford", async () => {
    await placeOrder(
      db,
      portfolio,
      { symbol: "NVDA", side: "buy", kind: "stop", quantity: 20, stopPrice: 400, timeInForce: "gtc" },
      quote("NVDA", 300),
      null,
      NOW,
    );

    const result = await matchOpenOrders(
      db,
      portfolio,
      new Map([["NVDA", quote("NVDA", 410)]]),
      NOW,
    );

    expect(result.filled).toBe(1);
    expect((await mockState(db, portfolio)).cash.toFixed(2)).toBe("1800.00");
  });
});

/**
 * Found on a real account. A buy stop at 950 was sent at 4:53 in the morning,
 * New York time, on a stock at 1,080. It filled on the spot at 1,080.53 —
 * the previous day's close, while the stock was trading near 1,092 before
 * the open. Two things were wrong: the stop was on the wrong side of the
 * market, and the price it filled at was not one anybody could trade at.
 */
describe("outside the regular session, and stops on the wrong side", () => {
  const at = (symbol: string, price: number, iso: string): Quote => ({
    ...quote(symbol, price),
    dataTimestamp: iso,
  });

  it("refuses a buy stop below the market, and says what was probably meant", async () => {
    await expect(
      placeOrder(
        db,
        portfolio,
        { symbol: "MU", side: "buy", kind: "stop", quantity: 1, stopPrice: 950 },
        quote("MU", 1080.53),
        null,
        NOW,
      ),
    ).rejects.toThrow(/use a limit order/);
    expect(await openOrders(db, portfolio.id)).toEqual([]);
  });

  it("refuses a sell stop above the market, and accepts one below it", async () => {
    await placeOrder(
      db,
      portfolio,
      { symbol: "NVDA", side: "buy", kind: "market", quantity: 10 },
      quote("NVDA", 200),
      null,
      NOW,
    );

    await expect(
      placeOrder(
        db,
        portfolio,
        { symbol: "NVDA", side: "sell", kind: "stop", quantity: 10, stopPrice: 210 },
        quote("NVDA", 200),
        null,
        NOW,
      ),
    ).rejects.toThrow(/use a limit order/);

    const { order } = await placeOrder(
      db,
      portfolio,
      { symbol: "NVDA", side: "sell", kind: "stop", quantity: 10, stopPrice: 190 },
      quote("NVDA", 200),
      null,
      NOW,
    );
    expect(order.status).toBe("open");
  });

  it("does not fill before the open on the last close, and fills on the first price after it", async () => {
    const early = "2026-09-22T08:53:46.000Z";
    const result = await placeOrder(
      db,
      portfolio,
      { symbol: "MU", side: "buy", kind: "market", quantity: 1 },
      at("MU", 1080.53, early),
      null,
      new Date(early),
    );
    expect(result.filled).toBe(false);
    expect(result.order.status).toBe("open");

    // Still pre-market: nothing fills, whatever the price does.
    await matchOpenOrders(
      db,
      portfolio,
      new Map([["MU", at("MU", 1092, "2026-09-22T13:29:00.000Z")]]),
      new Date("2026-09-22T13:29:30.000Z"),
    );
    expect(await openOrders(db, portfolio.id)).toHaveLength(1);

    // Open, but the price on hand printed before the open. Not yet.
    await matchOpenOrders(
      db,
      portfolio,
      new Map([["MU", at("MU", 1092, "2026-09-22T13:29:00.000Z")]]),
      new Date("2026-09-22T13:30:10.000Z"),
    );
    expect(await openOrders(db, portfolio.id)).toHaveLength(1);

    // The first print of the session fills it, at that print.
    await matchOpenOrders(
      db,
      portfolio,
      new Map([["MU", at("MU", 1093.1, "2026-09-22T13:30:02.000Z")]]),
      new Date("2026-09-22T13:30:10.000Z"),
    );
    expect(await openOrders(db, portfolio.id)).toEqual([]);
    expect((await mockState(db, portfolio)).cash.toFixed(2)).toBe("8906.90");
  });

  it("takes orders at the weekend on a Friday price, and holds them for Monday", async () => {
    const saturday = "2026-09-26T15:00:00.000Z";
    const result = await placeOrder(
      db,
      portfolio,
      { symbol: "NVDA", side: "buy", kind: "market", quantity: 1 },
      at("NVDA", 200, "2026-09-25T20:00:00.000Z"),
      null,
      new Date(saturday),
    );
    expect(result.filled).toBe(false);
  });
});

describe("when an order should fill", () => {
  const base = { id: "x", symbol: "NVDA", quantity: 1 } as unknown as Order;

  it("fills a limit buy at or below its limit", () => {
    const order = { ...base, kind: "limit", side: "buy", limitPrice: 100 } as Order;
    expect(fillsAt(order, 99)).toBe(true);
    expect(fillsAt(order, 100)).toBe(true);
    expect(fillsAt(order, 101)).toBe(false);
  });

  it("fills a limit sell at or above its limit", () => {
    const order = { ...base, kind: "limit", side: "sell", limitPrice: 100 } as Order;
    expect(fillsAt(order, 101)).toBe(true);
    expect(fillsAt(order, 99)).toBe(false);
  });

  it("triggers a stop when the price trades through it", () => {
    const stopLoss = { ...base, kind: "stop", side: "sell", stopPrice: 90 } as Order;
    expect(fillsAt(stopLoss, 89)).toBe(true);
    expect(fillsAt(stopLoss, 91)).toBe(false);

    const breakout = { ...base, kind: "stop", side: "buy", stopPrice: 110 } as Order;
    expect(fillsAt(breakout, 111)).toBe(true);
    expect(fillsAt(breakout, 109)).toBe(false);
  });
});

describe("which price is allowed to fill an order", () => {
  async function rest(limitPrice: number, at = NOW) {
    const { order } = await placeOrder(
      db,
      portfolio,
      { symbol: "NVDA", side: "buy", kind: "limit", quantity: 1, limitPrice },
      quote("NVDA", 200),
      null,
      at,
    );
    return order;
  }

  it("will not fill on a price that printed before the order existed", async () => {
    await rest(180);

    // A tick from four seconds ago. Quotes are cached for five, so without
    // this rule an order placed a moment ago fills on a price it had already
    // watched go by — free money for anybody who waits for the number to dip
    // before clicking.
    const stalePrint = quote("NVDA", 175, 4_000);
    const after = new Date(NOW.getTime() + 1_000);
    await matchOpenOrders(db, portfolio, new Map([["NVDA", stalePrint]]), after);

    expect((await openOrders(db, portfolio.id)).length).toBe(1);
  });

  it("fills on the next price that prints after it", async () => {
    await rest(180);

    const later = new Date(NOW.getTime() + 10_000);
    const fresh = {
      ...quote("NVDA", 175),
      dataTimestamp: new Date(NOW.getTime() + 8_000).toISOString(),
    };
    await matchOpenOrders(db, portfolio, new Map([["NVDA", fresh]]), later);

    expect(await openOrders(db, portfolio.id)).toEqual([]);
  });

  it("will not fill on a price from hours ago", async () => {
    await rest(180);

    const later = new Date(NOW.getTime() + 3 * 3_600_000);
    const old = {
      ...quote("NVDA", 175),
      dataTimestamp: new Date(NOW.getTime() + 60_000).toISOString(),
    };
    await matchOpenOrders(db, portfolio, new Map([["NVDA", old]]), later);

    expect((await openOrders(db, portfolio.id)).length).toBe(1);
  });

  it("keeps a day order until its session closes, and not a minute past", async () => {
    await rest(180);

    // 3:59 and 4:01 in the afternoon, New York.
    await matchOpenOrders(db, portfolio, new Map(), new Date("2026-09-22T19:59:00.000Z"));
    expect((await openOrders(db, portfolio.id)).length).toBe(1);

    const result = await matchOpenOrders(
      db,
      portfolio,
      new Map(),
      new Date("2026-09-22T20:01:00.000Z"),
    );
    expect(result.expired).toBe(1);
  });

  it("gives a day order sent in the evening the next session", async () => {
    // 8pm in New York is midnight UTC, a calendar day later. Measured in UTC
    // the order looked a day old at once; measured in sessions it is for
    // tomorrow's, as it would be at any broker.
    const evening = new Date("2026-09-23T00:00:00.000Z");
    await rest(180, evening);

    const nextMorning = new Date("2026-09-23T14:00:00.000Z");
    const result = await matchOpenOrders(
      db,
      portfolio,
      new Map([["NVDA", { ...quote("NVDA", 175), dataTimestamp: nextMorning.toISOString() }]]),
      nextMorning,
    );

    expect(result).toEqual({ filled: 1, expired: 0 });
  });

  it("gives an order sent at the weekend Monday's session", async () => {
    const saturday = new Date("2026-09-26T15:00:00.000Z");
    await rest(180, saturday);

    const monday = new Date("2026-09-28T14:00:00.000Z");
    await matchOpenOrders(db, portfolio, new Map(), monday);
    expect((await openOrders(db, portfolio.id)).length).toBe(1);
  });

  it("expires a day order once the trading day has actually turned over", async () => {
    const morning = new Date("2026-09-22T13:00:00.000Z");
    await rest(180, morning);

    const nextDay = new Date("2026-09-23T13:30:00.000Z");
    await matchOpenOrders(db, portfolio, new Map(), nextDay);

    const order = (await db.get<{ status: string }>(
      `SELECT status FROM orders WHERE portfolio_id = ?`,
      [portfolio.id],
    ))!;
    expect(order.status).toBe("expired");
  });
});
