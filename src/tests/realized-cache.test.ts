import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, TEST_PORTFOLIO_ID, type TestDb } from "@/lib/db/testing";
import { clearRealizedCache, realizedFor } from "@/lib/portfolio/realized-cache";

let db: TestDb;

async function addFill(
  side: "buy" | "sell",
  symbol: string,
  quantity: number,
  price: number,
  tradedAt: string,
) {
  await db.run(
    `INSERT INTO transactions
       (deal_id, side, symbol, quantity, price, amount, traded_at, synced_at, portfolio_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      side,
      symbol,
      quantity,
      price,
      quantity * price * (side === "buy" ? -1 : 1),
      tradedAt,
      tradedAt,
      TEST_PORTFOLIO_ID,
    ],
  );
}

beforeEach(async () => {
  db = await createTestDb();
  clearRealizedCache();
});

afterEach(async () => {
  await db.close();
});

describe("the realized-profit cache", () => {
  it("gives the same answer as replaying every time", async () => {
    await addFill("buy", "NVDA", 10, 200, "2026-06-03T14:00:00.000Z");
    await addFill("sell", "NVDA", 4, 250, "2026-07-01T14:00:00.000Z");

    expect((await realizedFor(db, TEST_PORTFOLIO_ID)).NVDA).toBeCloseTo(200, 6);
  });

  // The point of the fingerprint: a trade placed from the dashboard has to
  // show its result straight away, with nobody remembering to invalidate.
  it("recomputes as soon as a trade is added", async () => {
    await addFill("buy", "NVDA", 10, 200, "2026-06-03T14:00:00.000Z");
    expect(await realizedFor(db, TEST_PORTFOLIO_ID)).toEqual({});

    await addFill("sell", "NVDA", 10, 260, "2026-07-01T14:00:00.000Z");
    expect((await realizedFor(db, TEST_PORTFOLIO_ID)).NVDA).toBeCloseTo(600, 6);
  });

  it("recomputes when an existing fill is corrected", async () => {
    await addFill("buy", "NVDA", 10, 200, "2026-06-03T14:00:00.000Z");
    await addFill("sell", "NVDA", 10, 260, "2026-07-01T14:00:00.000Z");
    expect((await realizedFor(db, TEST_PORTFOLIO_ID)).NVDA).toBeCloseTo(600, 6);

    // An import correcting a price rewrites the row and moves synced_at.
    await db.run(
      `UPDATE transactions SET price = 300, synced_at = '2026-07-02T00:00:00.000Z'
        WHERE side = 'sell' AND portfolio_id = ?`,
      [TEST_PORTFOLIO_ID],
    );

    expect((await realizedFor(db, TEST_PORTFOLIO_ID)).NVDA).toBeCloseTo(1_000, 6);
  });

  it("serves a repeated read without the fills changing", async () => {
    await addFill("buy", "NVDA", 10, 200, "2026-06-03T14:00:00.000Z");
    await addFill("sell", "NVDA", 5, 240, "2026-07-01T14:00:00.000Z");

    const first = await realizedFor(db, TEST_PORTFOLIO_ID);
    const second = await realizedFor(db, TEST_PORTFOLIO_ID);
    expect(second).toBe(first);
  });

  it("keeps portfolios apart", async () => {
    const other = randomUUID();
    await db.run(
      `INSERT INTO portfolios (id, slug, display_name, kind, base_currency, created_at)
       VALUES (?, 'other', 'Other', 'broker', 'USD', ?)`,
      [other, new Date().toISOString()],
    );
    await addFill("buy", "NVDA", 10, 200, "2026-06-03T14:00:00.000Z");
    await addFill("sell", "NVDA", 10, 260, "2026-07-01T14:00:00.000Z");

    expect((await realizedFor(db, TEST_PORTFOLIO_ID)).NVDA).toBeCloseTo(600, 6);
    expect(await realizedFor(db, other)).toEqual({});
  });
});
