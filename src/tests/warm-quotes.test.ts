import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createTestDb, TEST_PORTFOLIO_ID, type TestDb } from "@/lib/db/testing";
import { createPortfolio } from "@/lib/portfolios";

let db: TestDb;

async function hold(portfolioId: string, symbol: string, underlying?: string) {
  await db.run(
    `INSERT INTO positions
       (id, broker, instrument_type, symbol, underlying_symbol, quantity,
        currency, synced_at, portfolio_id)
     VALUES (?, 'moomoo', ?, ?, ?, 1, 'USD', ?, ?)`,
    [
      randomUUID(),
      underlying ? "option" : "stock",
      symbol,
      underlying ?? null,
      new Date().toISOString(),
      portfolioId,
    ],
  );
}

/**
 * The union query the warmer runs. Exercised directly rather than through
 * warmQuotes, which would need a broker connection: the claim being tested is
 * "one price per name across the whole site", and that is this query.
 */
async function symbolsToWarm(): Promise<string[]> {
  const rows = await db.all<{ symbol: string; underlying_symbol: string | null }>(
    `SELECT DISTINCT symbol, underlying_symbol FROM positions
      WHERE instrument_type <> 'cash'
     UNION
     SELECT DISTINCT symbol, NULL FROM orders WHERE status = 'open'`,
  );
  return [
    ...new Set(
      rows.flatMap((row) =>
        [row.symbol, row.underlying_symbol].filter(
          (value): value is string => typeof value === "string" && value.length > 0,
        ),
      ),
    ),
  ].sort();
}

beforeEach(async () => {
  db = await createTestDb();
});

afterEach(async () => {
  await db.close();
});

describe("warming the price cache for everybody at once", () => {
  it("asks for a name once however many accounts hold it", async () => {
    const second = await createPortfolio(db, {
      slug: "mother",
      displayName: "Mother",
      ownerUserId: null,
      kind: "broker",
    });

    await hold(TEST_PORTFOLIO_ID, "NVDA");
    await hold(second.id, "NVDA");
    await hold(second.id, "AMD");

    expect(await symbolsToWarm()).toEqual(["AMD", "NVDA"]);
  });

  it("includes the underlying of an option, which nobody may hold directly", async () => {
    await hold(TEST_PORTFOLIO_ID, "NBIS261218C200000", "NBIS");
    expect(await symbolsToWarm()).toContain("NBIS");
  });

  it("includes a symbol that only has an order resting on it", async () => {
    await db.run(
      `INSERT INTO orders
         (id, portfolio_id, symbol, side, kind, quantity, time_in_force,
          status, placed_at, updated_at)
       VALUES (?, ?, 'TSLA', 'buy', 'limit', 1, 'day', 'open', ?, ?)`,
      [randomUUID(), TEST_PORTFOLIO_ID, new Date().toISOString(), new Date().toISOString()],
    );

    expect(await symbolsToWarm()).toContain("TSLA");
  });

  it("leaves cash out, which has no price to fetch", async () => {
    await db.run(
      `INSERT INTO positions
         (id, broker, instrument_type, symbol, quantity, currency, synced_at, portfolio_id)
       VALUES (?, 'moomoo', 'cash', 'USD.CASH', 100, 'USD', ?, ?)`,
      [randomUUID(), new Date().toISOString(), TEST_PORTFOLIO_ID],
    );
    await hold(TEST_PORTFOLIO_ID, "NVDA");

    expect(await symbolsToWarm()).toEqual(["NVDA"]);
  });
});
