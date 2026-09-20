import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/lib/db/testing";
import { readSnapshots, writeSnapshot } from "@/lib/portfolio/snapshots";

let db: TestDb;
beforeEach(async () => {
  db = await createTestDb();
});
afterEach(async () => {
  await db.close();
});

const usd = (amount: string) => ({ amount, currency: "USD" });

describe("what a snapshot records", () => {
  // A day recorded without these cannot be re-derived later: the prices that
  // produced it are gone. Everything needed to draw total return has to be in
  // the row at the time it is written.
  it("keeps realized and deposits, so total return is recoverable per day", async () => {
    await writeSnapshot(
      db,
      "2026-09-20",
      {
        totalMarketValue: usd("22070.41"),
        totalCostBasis: usd("24205.87"),
        totalUnrealizedPnL: usd("-1358.46"),
        cashValue: usd("6807.62"),
        realizedPnL: usd("1328.87"),
        netDeposits: usd("22100"),
      },
      "[]",
    );

    const [row] = await readSnapshots(db);
    expect(row.realizedPnL).toBe("1328.87");
    expect(row.netDeposits).toBe("22100");
    expect(row.source).toBe("live");

    // value − deposits is the day's total return, and it agrees with the parts
    const total = Number(row.totalMarketValue) - Number(row.netDeposits);
    expect(total).toBeCloseTo(
      Number(row.totalUnrealizedPnL) + Number(row.realizedPnL!),
      2,
    );
  });

  it("marks a reconstructed day as such, so a chart can say so", async () => {
    await writeSnapshot(
      db,
      "2026-07-01",
      {
        totalMarketValue: usd("100"),
        totalCostBasis: usd("100"),
        totalUnrealizedPnL: usd("0"),
        cashValue: usd("0"),
        realizedPnL: usd("0"),
        netDeposits: null,
      },
      "[]",
      new Date(),
      "reconstructed",
    );
    const [row] = await readSnapshots(db);
    expect(row.source).toBe("reconstructed");
    expect(row.netDeposits).toBeNull();
  });
});
