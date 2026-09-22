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
