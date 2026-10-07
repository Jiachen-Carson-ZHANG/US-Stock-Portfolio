import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, TEST_PORTFOLIO_ID, type TestDb } from "@/lib/db/testing";
import { resetDbForTests } from "@/lib/db";
import { createPortfolio } from "@/lib/portfolios";
import { captureDailySnapshots } from "@/lib/portfolio/daily-capture";
import { readSnapshots } from "@/lib/portfolio/snapshots";
import { readAnalysis } from "@/lib/analysis/store";
import { rebuildHistory } from "@/lib/portfolio/rebuild";
import { loadPortfolio } from "@/lib/portfolio/service";

/**
 * Nothing had been recorded since the 21st, and practice accounts had never
 * been recorded at all: a snapshot needed somebody to open an account between
 * 4pm and midnight New York time, and a cash-only account never qualified.
 */
let db: TestDb;
let practice: string;

// Friday 25 September 2026: 5pm and 11am in New York.
const EVENING = new Date("2026-09-25T21:00:00Z");
const MORNING = new Date("2026-09-25T15:00:00Z");

beforeEach(async () => {
  db = await createTestDb();
  resetDbForTests(db);
  practice = (
    await createPortfolio(
      db,
      { slug: "mia-mock", displayName: "Mia", ownerUserId: null, kind: "mock", openingCash: "50000" },
      new Date("2026-09-21T02:00:00Z"),
    )
  ).id;
});

afterEach(async () => {
  resetDbForTests(null);
  await db.close();
});

describe("the evening snapshot", () => {
  it("records a practice account that holds only cash", async () => {
    const { date, results } = await captureDailySnapshots(EVENING);
    expect(date).toBe("2026-09-25");
    expect(results.find((r) => r.slug === "mia-mock")).toMatchObject({ captured: true });

    const [snapshot] = await readSnapshots(db, practice);
    expect(snapshot.snapshotDate).toBe("2026-09-25");
    expect(Number(snapshot.totalMarketValue)).toBe(50000);
  });

  it("skips a real account with nothing connected, rather than failing", async () => {
    const { results } = await captureDailySnapshots(EVENING);
    expect(results.find((r) => r.slug === "carson")).toMatchObject({
      captured: false,
      reason: "Not connected",
    });
  });

  it("does nothing before the close, and nothing twice", async () => {
    expect((await captureDailySnapshots(MORNING)).date).toBeNull();

    await captureDailySnapshots(EVENING);
    const again = await captureDailySnapshots(new Date(EVENING.getTime() + 600_000));
    expect(again.results.every((r) => !r.captured)).toBe(true);
    expect(await readSnapshots(db, practice)).toHaveLength(1);
  });
});

describe("a real account holding cash", () => {
  it("is recorded although cash never gets a fresh price", async () => {
    // The broker reports cash as USD.CASH. It was asked for a quote with the
    // holdings, the feed never answers for cash, and its cached row from the
    // 18th marked the account stale every evening, so carson stopped at the 21st.
    const at = (when: Date) => when.toISOString();
    for (const [symbol, type, quantity] of [["NVDA", "stock", 10], ["USD.CASH", "cash", 500]] as const) {
      await db.run(
        `INSERT INTO positions
           (id, broker, instrument_type, symbol, quantity, average_cost, currency, synced_at, portfolio_id)
         VALUES (?, 'moomoo', ?, ?, ?, 100, 'USD', ?, ?)`,
        [`${symbol}-row`, type, symbol, quantity, at(EVENING), TEST_PORTFOLIO_ID],
      );
    }
    for (const [symbol, cachedAt] of [["NVDA", new Date(EVENING.getTime() - 5_000)], ["USD.CASH", new Date("2026-09-18T09:25:10Z")]] as const) {
      await db.run(
        `INSERT INTO quote_cache (symbol, price, previous_close, change, change_percent, market_status, data_timestamp, source, cached_at)
         VALUES (?, 1, 1, 0, 0, 'closed', ?, 'test', ?)`,
        [symbol, at(cachedAt), at(cachedAt)],
      );
    }

    const { summary } = await loadPortfolio(TEST_PORTFOLIO_ID, EVENING);
    expect(summary.isStale).toBe(false);
    expect((await readSnapshots(db, TEST_PORTFOLIO_ID)).map((s) => s.snapshotDate)).toEqual(["2026-09-25"]);
  });
});

describe("a practice account's ledger", () => {
  it("is complete without anybody signing it off", async () => {
    expect((await readAnalysis(db, practice)).coverage).not.toBeNull();
    // A real account still needs its transfers confirmed.
    expect((await readAnalysis(db, TEST_PORTFOLIO_ID)).coverage).toBeNull();
  });
});

describe("filling in the days that were missed", () => {
  it("rebuilds an account that never traded as its balance, every weekday", async () => {
    const report = await rebuildHistory({
      db,
      portfolioId: practice,
      loadPrices: async () => {
        throw new Error("an untraded account needs no prices");
      },
      opening: { date: "2026-09-21", amount: 50000 },
      write: true,
      now: new Date("2026-09-28T14:00:00Z"),
    });

    expect(report.refusals).toEqual([]);
    const snapshots = await readSnapshots(db, practice);
    expect(snapshots.map((s) => s.snapshotDate)).toEqual([
      "2026-09-21",
      "2026-09-22",
      "2026-09-23",
      "2026-09-24",
      "2026-09-25",
    ]);
    expect(snapshots.every((s) => Number(s.totalMarketValue) === 50000)).toBe(true);
  });
});
