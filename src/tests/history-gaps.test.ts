import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, TEST_PORTFOLIO_ID, type TestDb } from "@/lib/db/testing";
import { resetDbForTests } from "@/lib/db";
import { missingWeekdays } from "@/lib/portfolio/gap-fill";
import { rebuildHistory, type PriceLoader } from "@/lib/portfolio/rebuild";
import { readSnapshots } from "@/lib/portfolio/snapshots";

/**
 * The owner's account stopped at 21 September. The capture was fixed on the
 * 27th, but the four days between stayed empty: the rebuild that should have
 * filled them refused the account every time — it valued the options at
 * their last trade and the live account at the broker's mark, and for
 * contracts that trade rarely those were hundreds of dollars apart.
 */

describe("which days are missing", () => {
  it("finds the weekdays between the last snapshot and today", () => {
    expect(missingWeekdays(["2026-09-17", "2026-09-18", "2026-09-21"], "2026-09-28")).toEqual([
      "2026-09-22",
      "2026-09-23",
      "2026-09-24",
      "2026-09-25",
    ]);
  });

  it("counts a practice account's days from when it was opened, though nothing was recorded", () => {
    expect(missingWeekdays([], "2026-09-28", { since: "2026-09-24" })).toEqual(["2026-09-24", "2026-09-25"]);
  });

  it("looks back only so far", () => {
    expect(missingWeekdays(["2026-01-05"], "2026-09-28", { lookbackDays: 7 })).toEqual([
      "2026-09-21",
      "2026-09-22",
      "2026-09-23",
      "2026-09-24",
      "2026-09-25",
    ]);
  });
});

describe("the rebuild's check against the live account", () => {
  let db: TestDb;
  const OPTION = "XYZ261218C100000";

  async function fill(symbol: string, quantity: number, price: number, multiplier: number, date: string) {
    await db.run(
      `INSERT INTO transactions
         (deal_id, side, symbol, quantity, price, amount, traded_at, synced_at, portfolio_id)
       VALUES (?, 'buy', ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        symbol,
        quantity,
        price,
        -quantity * price * multiplier,
        `${date}T15:00:00.000Z`,
        new Date().toISOString(),
        TEST_PORTFOLIO_ID,
      ],
    );
  }

  // Every day closes where it opened: the option last traded at 5.00 and has
  // not traded since, while the broker marks it at 8.00.
  const loadPrices: PriceLoader = async (symbols) => ({
    prices: new Map(
      symbols.map((symbol) => [
        symbol,
        new Map(["2026-09-02", "2026-09-03", "2026-09-04"].map((date) => [date, symbol === OPTION ? 5 : 100])),
      ]),
    ),
    missing: [],
  });
  const NOW = new Date("2026-09-04T21:00:00Z");

  beforeEach(async () => {
    db = await createTestDb();
    resetDbForTests(db);
    await db.run(
      `INSERT INTO analysis_flows (id, date, amount, note, created_by, portfolio_id) VALUES (?, ?, ?, '', 'test', ?)`,
      [randomUUID(), "2026-09-01", 10_000, TEST_PORTFOLIO_ID],
    );
    await fill(OPTION, 1, 5, 100, "2026-09-02");
    await fill("AAA", 10, 100, 1, "2026-09-02");
  });

  afterEach(async () => {
    resetDbForTests(null);
    await db.close();
  });

  it("accepts an account whose holdings match, whatever price each side used", async () => {
    // Live: the option at the broker's 8.00 mark, the shares, and the cash.
    const liveValue = 800 + 1_000 + 8_500;
    const report = await rebuildHistory({
      db,
      portfolioId: TEST_PORTFOLIO_ID,
      loadPrices,
      liveValue,
      liveMarks: new Map([
        [OPTION, 800],
        ["AAA", 100],
      ]),
      write: true,
      now: NOW,
    });
    expect(report.refusals).toEqual([]);
    expect(report.written).toBe(3);
  });

  it("still refuses when something is really missing, and says so plainly", async () => {
    // The live account also holds 400 dollars of something no trade explains.
    const report = await rebuildHistory({
      db,
      portfolioId: TEST_PORTFOLIO_ID,
      loadPrices,
      liveValue: 800 + 1_000 + 8_500 + 400,
      liveMarks: new Map([
        [OPTION, 800],
        ["AAA", 100],
        ["BBB", 400],
      ]),
      write: true,
      now: NOW,
    });
    expect(report.written).toBe(0);
    expect(report.refusals.join(" ")).toMatch(/lands \$400\.00 away from what the broker shows now/);
  });

  it("writes only the days it is asked to fill", async () => {
    await rebuildHistory({
      db,
      portfolioId: TEST_PORTFOLIO_ID,
      loadPrices,
      write: true,
      now: NOW,
      only: new Set(["2026-09-03"]),
    });
    expect((await readSnapshots(db, TEST_PORTFOLIO_ID)).map((s) => s.snapshotDate)).toEqual(["2026-09-03"]);
  });
});
