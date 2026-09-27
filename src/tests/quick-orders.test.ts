import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createTestDb, TEST_PORTFOLIO_ID, type TestDb } from "@/lib/db/testing";
import { resetDbForTests } from "@/lib/db";
import { openOrders, placeOrder } from "@/lib/trading/orders";
import type { Portfolio } from "@/lib/portfolios";
import type { Quote } from "@/types/market";

/**
 * Pending orders are checked every three seconds on fresh prices for their own
 * symbols, not every ten on whatever the shared cache holds.
 */

// Tuesday 22 September 2026, 10am in New York.
const NOW = new Date("2026-09-22T14:00:00.000Z");

const mocks = vi.hoisted(() => ({ price: 0, asked: [] as string[][] }));

function quote(symbol: string, price: number, at: Date): Quote {
  return {
    symbol,
    name: symbol,
    price,
    previousClose: price,
    change: 0,
    changePercent: 0,
    marketStatus: "regular",
    dataTimestamp: at.toISOString(),
    source: "test",
  };
}

vi.mock("@/providers", async (original) => ({
  ...(await original<typeof import("@/providers")>()),
  getMarketDataProvider: async () => ({
    getQuotes: async (symbols: string[]) => {
      mocks.asked.push(symbols);
      return symbols.map((symbol) => quote(symbol, mocks.price, new Date(NOW.getTime() + 1_000)));
    },
    getHistoricalPrices: async () => [],
  }),
}));

import { matchRestingOrdersQuickly } from "@/lib/portfolio/service";

let db: TestDb;
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

beforeEach(async () => {
  db = await createTestDb();
  resetDbForTests(db);
  await db.run(`UPDATE portfolios SET kind = 'mock', opening_cash = '10000' WHERE id = ?`, [TEST_PORTFOLIO_ID]);
  mocks.asked = [];
});

afterEach(async () => {
  resetDbForTests(null);
  await db.close();
});

it("asks for nothing when no order is waiting", async () => {
  expect(await matchRestingOrdersQuickly(NOW)).toEqual({ symbols: 0, filled: 0 });
  expect(mocks.asked).toEqual([]);
});

it("fetches past a price the cache would still call fresh, and fills on it", async () => {
  const placed = new Date(NOW.getTime() - 10_000);
  await placeOrder(
    db,
    portfolio,
    { symbol: "NVDA", side: "buy", kind: "limit", quantity: 1, limitPrice: 180 },
    quote("NVDA", 200, placed),
    null,
    placed,
  );
  // Five seconds old: inside the ten the cache keeps a price for, and above
  // the limit. The quick check must not settle for it.
  await db.run(
    `INSERT INTO quote_cache (symbol, price, previous_close, change, change_percent, market_status, data_timestamp, source, cached_at)
     VALUES ('NVDA', 200, 200, 0, 0, 'regular', ?, 'test', ?)`,
    [new Date(NOW.getTime() - 5_000).toISOString(), new Date(NOW.getTime() - 5_000).toISOString()],
  );

  mocks.price = 179;
  const result = await matchRestingOrdersQuickly(new Date(NOW.getTime() + 2_000));

  expect(mocks.asked[0]).toEqual(["NVDA"]);
  expect(result).toEqual({ symbols: 1, filled: 1 });
  expect(await openOrders(db, TEST_PORTFOLIO_ID)).toEqual([]);
});
