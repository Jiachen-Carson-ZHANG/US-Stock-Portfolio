import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, TEST_PORTFOLIO_ID, type TestDb } from "@/lib/db/testing";
import { mockState, syncMockPositions } from "@/lib/portfolio/mock";
import { placeOrder } from "@/lib/trading/orders";
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

describe("mock holdings in the shared positions table", () => {
  it("writes holdings and cash the rest of the app can read", async () => {
    await placeOrder(
      db,
      paper,
      { symbol: "NVDA", side: "buy", kind: "market", quantity: 10 },
      quote("NVDA", 200),
      null,
      NOW,
    );

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
    await placeOrder(
      db,
      paper,
      { symbol: "NVDA", side: "buy", kind: "market", quantity: 1 },
      quote("NVDA", 200),
      null,
      NOW,
    );

    await syncMockPositions(db, paper, new Map([["NVDA", quote("NVDA", 200)]]), NOW);
    await syncMockPositions(db, paper, new Map([["NVDA", quote("NVDA", 210)]]), NOW);

    const positions = await readPositions(db, paper.id);
    expect(positions.filter((p) => p.symbol === "NVDA")).toHaveLength(1);
  });
});

/**
 * A share bought this morning was never worth yesterday's close to the person
 * who bought it. Measuring "today" from that close showed a profit the moment
 * an order filled — found on a real account, where a buy at 1,080.53 on a
 * stock that had closed at 1,071.88 read +8.65 today before anything moved.
 */
describe("today's profit on a mock position", () => {
  const priced = (symbol: string, price: number, previousClose: number, iso = NOW.toISOString()): Quote => ({
    ...quote(symbol, price),
    previousClose,
    dataTimestamp: iso,
  });
  const todayOf = async (symbol: string) =>
    (await readPositions(db, paper.id)).find((p) => p.symbol === symbol)?.reportedTodayPnL;
  const buy = (symbol: string, quantity: number, q: Quote, at: Date) =>
    placeOrder(db, paper, { symbol, side: "buy", kind: "market", quantity }, q, null, at);

  it("measures a share bought today from what was paid", async () => {
    await buy("MU", 1, priced("MU", 1080.53, 1071.88), NOW);

    await syncMockPositions(db, paper, new Map([["MU", priced("MU", 1080.53, 1071.88)]]), NOW);
    expect(await todayOf("MU")).toBeCloseTo(0, 6);

    await syncMockPositions(db, paper, new Map([["MU", priced("MU", 1090, 1071.88)]]), NOW);
    expect(await todayOf("MU")).toBeCloseTo(9.47, 6);
  });

  it("measures shares held since before today from the previous close", async () => {
    // Bought on the Friday, looked at on the Monday.
    const friday = new Date("2026-09-18T14:00:00.000Z");
    await buy("NVDA", 10, priced("NVDA", 98, 97, friday.toISOString()), friday);

    await syncMockPositions(db, paper, new Map([["NVDA", priced("NVDA", 105, 100)]]), NOW);
    expect(await todayOf("NVDA")).toBeCloseTo(50, 6);
  });

  it("splits a holding that was topped up today", async () => {
    const friday = new Date("2026-09-18T14:00:00.000Z");
    await buy("NVDA", 10, priced("NVDA", 98, 97, friday.toISOString()), friday);
    await buy("NVDA", 5, priced("NVDA", 102, 100), NOW);

    // Ten carried over: 10 x (103 - 100). Five bought today: 5 x (103 - 102).
    await syncMockPositions(db, paper, new Map([["NVDA", priced("NVDA", 103, 100)]]), NOW);
    expect(await todayOf("NVDA")).toBeCloseTo(35, 6);
  });

  it("still counts yesterday's buys as today's before the open", async () => {
    // Before 9:30 the feed's "today" is still the session just gone: its price
    // is yesterday's close and its previous close the day before's. A share
    // bought yesterday at 1,080 has made 1,085 - 1,080 in that session, not
    // 1,085 - 1,071.
    await buy("MU", 1, priced("MU", 1080, 1071), NOW);

    const tuesdayPreMarket = new Date("2026-09-22T12:00:00.000Z");
    await syncMockPositions(
      db,
      paper,
      new Map([["MU", priced("MU", 1085, 1071, tuesdayPreMarket.toISOString())]]),
      tuesdayPreMarket,
    );
    expect(await todayOf("MU")).toBeCloseTo(5, 6);
  });
});

describe("a brand-new mock account", () => {
  it("counts its opening balance as the money paid in, not the real account's", async () => {
    const { netDeposits } = await import("@/lib/portfolio/service");

    // TOTAL_DEPOSITS describes Carson's real account. Applied to a fresh
    // mock account it reported $22,100 paid in and a $12,100 loss on day
    // one, which is how this was found.
    const previous = process.env.TOTAL_DEPOSITS;
    process.env.TOTAL_DEPOSITS = "22100";
    try {
      const deposits = await netDeposits(db, paper, "USD");
      expect(deposits?.amount.toFixed(2)).toBe("10000.00");
    } finally {
      if (previous === undefined) delete process.env.TOTAL_DEPOSITS;
      else process.env.TOTAL_DEPOSITS = previous;
    }
  });

  it("adds a later transfer to the opening balance", async () => {
    const { netDeposits } = await import("@/lib/portfolio/service");
    await db.run(
      `INSERT INTO analysis_flows (id, date, amount, note, created_by, portfolio_id)
       VALUES (?, '2026-09-01', 2500, 'top up', 'test', ?)`,
      [crypto.randomUUID(), TEST_PORTFOLIO_ID],
    );

    const deposits = await netDeposits(db, paper, "USD");
    expect(deposits?.amount.toFixed(2)).toBe("12500.00");
  });

  it("leaves a real portfolio that is not the original one without a figure", async () => {
    const { netDeposits } = await import("@/lib/portfolio/service");
    const previous = process.env.TOTAL_DEPOSITS;
    process.env.TOTAL_DEPOSITS = "22100";
    try {
      const other = { ...paper, kind: "broker" as const, slug: "mirat" };
      expect(await netDeposits(db, other, "USD")).toBeNull();
    } finally {
      if (previous === undefined) delete process.env.TOTAL_DEPOSITS;
      else process.env.TOTAL_DEPOSITS = previous;
    }
  });
});
