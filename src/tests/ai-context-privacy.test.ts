import { afterEach, beforeEach, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/lib/db/testing";
import { resetDbForTests } from "@/lib/db";
import { createPortfolio } from "@/lib/portfolios";
import { placeOrder } from "@/lib/trading/orders";
import { buildAiContext } from "@/lib/ai/context";
import type { Quote } from "@/types/market";

/**
 * What leaves the server for the AI provider: shares and returns, never the
 * size of anybody's account.
 */
let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
  resetDbForTests(db);
});

afterEach(async () => {
  resetDbForTests(null);
  await db.close();
});

it("sends weights and returns, and no money", async () => {
  const portfolio = await createPortfolio(
    db,
    { slug: "mia-mock", displayName: "Mia", ownerUserId: null, kind: "mock", openingCash: "12345" },
    new Date("2026-09-21T14:00:00Z"),
  );
  const at = new Date("2026-09-22T14:00:00Z");
  const quote: Quote = {
    symbol: "AAPL",
    name: "Apple",
    price: 195.2,
    previousClose: 193.1,
    change: 2.1,
    changePercent: 1.09,
    marketStatus: "regular",
    dataTimestamp: at.toISOString(),
    source: "test",
  };
  await placeOrder(db, portfolio, { symbol: "AAPL", side: "buy", kind: "market", quantity: 7 }, quote, null, at);

  const text = await buildAiContext(portfolio.id, at);

  expect(text).toContain("percentages only");
  expect(text).toMatch(/AAPL \| \d+\.\d% \|/);
  // Not the opening balance, the cash left, the holding's value or its size.
  for (const secret of ["12345", "12,345", "10978", "1366", "1,366", "| 7 |", "7x"]) {
    expect(text).not.toContain(secret);
  }
  expect(text).not.toMatch(/\$\s?\d/);
});
