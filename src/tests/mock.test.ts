import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, TEST_PORTFOLIO_ID, type TestDb } from "@/lib/db/testing";
import {
  MAX_QUOTE_AGE_MS,
  MockTradeError,
  mockState,
  placeMockTrade,
  syncMockPositions,
} from "@/lib/portfolio/mock";
import { readPositions } from "@/lib/portfolio/sync";
import type { Portfolio } from "@/lib/portfolios";
import type { Quote } from "@/types/market";

let db: TestDb;

const NOW = new Date("2026-09-21T14:00:00.000Z");

const paper: Portfolio = {
  id: TEST_PORTFOLIO_ID,
  slug: "father-mock",
  displayName: "Dad",
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

describe("paper trading", () => {
  it("starts with the opening balance and nothing held", async () => {
    const state = await mockState(db, paper);
    expect(state.cash.toFixed(2)).toBe("10000.00");
    expect(state.holdings.size).toBe(0);
  });

  it("spends cash on a buy and returns it on a sell", async () => {
    await placeMockTrade(db, paper, { side: "buy", symbol: "NVDA", quantity: 10 },
      quote("NVDA", 200), NOW);
    expect((await mockState(db, paper)).cash.toFixed(2)).toBe("8000.00");

    await placeMockTrade(db, paper, { side: "sell", symbol: "NVDA", quantity: 4 },
      quote("NVDA", 250), NOW);
    expect((await mockState(db, paper)).cash.toFixed(2)).toBe("9000.00");

    const held = (await mockState(db, paper)).holdings.get("NVDA");
    expect(held?.quantity.toNumber()).toBe(6);
  });

  it("refuses to spend money that is not there", async () => {
    await expect(
      placeMockTrade(db, paper, { side: "buy", symbol: "NVDA", quantity: 100 },
        quote("NVDA", 200), NOW),
    ).rejects.toBeInstanceOf(MockTradeError);

    expect((await mockState(db, paper)).cash.toFixed(2)).toBe("10000.00");
  });

  // Short selling is the one position whose loss is not bounded by the
  // opening balance, which would make the ranking meaningless.
  it("refuses to sell more than is held", async () => {
    await placeMockTrade(db, paper, { side: "buy", symbol: "NVDA", quantity: 2 },
      quote("NVDA", 200), NOW);

    await expect(
      placeMockTrade(db, paper, { side: "sell", symbol: "NVDA", quantity: 3 },
        quote("NVDA", 200), NOW),
    ).rejects.toThrow(/cannot sell/);
  });

  it("refuses a stale price", async () => {
    await expect(
      placeMockTrade(db, paper, { side: "buy", symbol: "NVDA", quantity: 1 },
        quote("NVDA", 200, MAX_QUOTE_AGE_MS + 60_000), NOW),
    ).rejects.toThrow(/fifteen minutes/);
  });

  it("refuses a fractional or negative quantity", async () => {
    for (const quantity of [0, -5, 1.5]) {
      await expect(
        placeMockTrade(db, paper, { side: "buy", symbol: "NVDA", quantity },
          quote("NVDA", 200), NOW),
      ).rejects.toThrow(/whole number/);
    }
  });

  it("refuses to trade in a portfolio that follows a real account", async () => {
    await expect(
      placeMockTrade(
        db,
        { ...paper, kind: "broker" },
        { side: "buy", symbol: "NVDA", quantity: 1 },
        quote("NVDA", 200),
        NOW,
      ),
    ).rejects.toThrow(/real brokerage/);
  });

  it("prices an option contract at a hundred shares", async () => {
    await placeMockTrade(
      db,
      paper,
      { side: "buy", symbol: "NVDA270115C00200000", quantity: 1 },
      quote("NVDA270115C00200000", 20),
      NOW,
    );
    // One contract at 20 is 2,000, not 20.
    expect((await mockState(db, paper)).cash.toFixed(2)).toBe("8000.00");
  });
});

describe("mock holdings in the shared positions table", () => {
  it("writes holdings and cash the rest of the app can read", async () => {
    await placeMockTrade(db, paper, { side: "buy", symbol: "NVDA", quantity: 10 },
      quote("NVDA", 200), NOW);

    await syncMockPositions(
      db,
      paper,
      new Map([["NVDA", quote("NVDA", 220)]]),
      NOW,
    );

    const positions = await readPositions(db, paper.id);
    const nvda = positions.find((p) => p.symbol === "NVDA");
    const cash = positions.find((p) => p.instrumentType === "cash");

    expect(nvda?.quantity).toBe(10);
    expect(nvda?.averageCost).toBe(200);
    expect(nvda?.reportedMarketValue).toBe(2200);
    expect(cash?.quantity).toBe(8000);
  });

  it("replaces rather than accumulates on a second sync", async () => {
    await placeMockTrade(db, paper, { side: "buy", symbol: "NVDA", quantity: 1 },
      quote("NVDA", 200), NOW);

    await syncMockPositions(db, paper, new Map([["NVDA", quote("NVDA", 200)]]), NOW);
    await syncMockPositions(db, paper, new Map([["NVDA", quote("NVDA", 210)]]), NOW);

    const positions = await readPositions(db, paper.id);
    expect(positions.filter((p) => p.symbol === "NVDA")).toHaveLength(1);
  });
});
