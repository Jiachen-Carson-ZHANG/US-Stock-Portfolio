import { describe, expect, it, vi } from "vitest";
import { createTestDb } from "@/lib/db/testing";
import {
  readSnapshots,
  writeSnapshot,
  maybeCreateSnapshot,
} from "@/lib/portfolio/snapshots";
import { addToWatchlist, readWatchlist } from "@/lib/watchlist";
import {
  adjustedSeries,
  analysisStats,
  fxDecomposition,
  expirationPayoff,
} from "@/lib/analysis/math";
import { analysisInputSchema } from "@/lib/analysis/store";
import type { PortfolioSnapshot, PortfolioSummary } from "@/types/portfolio";
const snap = (date: string, value: number): PortfolioSnapshot => ({
  snapshotDate: date,
  totalMarketValue: String(value),
  totalCost: "100",
  totalUnrealizedPnL: "0",
  cashValue: "0",
});
const review = { from: "2026-09-01", to: "2026-09-30" };
describe("trustworthy analysis", () => {
  it("does not mistake a deposit for investment profit", async () => {
    const result = adjustedSeries(
      [snap("2026-09-14", 100), snap("2026-09-15", 160)],
      [{ date: "2026-09-15", amount: 50 }],
      review,
    );
    expect(result.points[1].index).toBeCloseTo(110);
    expect(result.gain).toBeCloseTo(10);
  });
  it("does not publish returns before cash flows are reviewed", async () => {
    expect(
      adjustedSeries(
        [snap("2026-09-14", 100), snap("2026-09-15", 160)],
        [],
        null,
      ).points,
    ).toEqual([]);
  });
  it("does not turn a multiday gap into a best day or daily volatility", async () => {
    const result = adjustedSeries(
      [
        snap("2026-09-14", 100),
        snap("2026-09-16", 110),
        snap("2026-09-17", 112),
      ],
      [],
      review,
    );
    expect(analysisStats(result).bestDayPercent).toBeNull();
    expect(analysisStats(result).annualisedVolatilityPercent).toBeNull();
  });
  it("withholds a return if a cash flow has no matching closing valuation", async () => {
    expect(
      adjustedSeries(
        [snap("2026-09-14", 100), snap("2026-09-16", 160)],
        [{ date: "2026-09-15", amount: 50 }],
        review,
      ).points,
    ).toEqual([]);
  });
  it("decomposes USD and FX effects without losing the cross term", async () => {
    const result = fxDecomposition(100, 110, 7, 7.2);
    expect(result.total).toBeCloseTo(92);
    expect(result.investment + result.currency).toBeCloseTo(result.total);
  });
  it("calculates a debit call spread payoff and fees", async () => {
    const legs = [
      {
        type: "call" as const,
        strike: 100,
        premium: 8,
        quantity: 1,
        multiplier: 100,
      },
      {
        type: "call" as const,
        strike: 110,
        premium: 3,
        quantity: -1,
        multiplier: 100,
      },
    ];
    expect(expirationPayoff(legs, 120, 4)).toBe(496);
    expect(expirationPayoff(legs, 90, 4)).toBe(-504);
  });
  it("rejects invalid dates and negative FX rates", async () => {
    expect(
      analysisInputSchema.safeParse({
        action: "flow",
        date: "2026-02-30",
        amount: 100,
        note: "",
      }).success,
    ).toBe(false);
    expect(
      analysisInputSchema.safeParse({
        action: "observations",
        kind: "fx",
        source: "test",
        rows: [{ date: "2026-09-14", value: -1 }],
      }).success,
    ).toBe(false);
  });
});
describe("history and collaboration regressions", () => {
  it("returns newest snapshots in chronological order", async () => {
    const db = await createTestDb();
    const summary = {
      totalMarketValue: { amount: "100", currency: "USD" },
      totalCostBasis: { amount: "100", currency: "USD" },
      totalUnrealizedPnL: { amount: "0", currency: "USD" },
      cashValue: { amount: "0", currency: "USD" },
    };
    for (const date of ["2026-09-14", "2026-09-15", "2026-09-16"])
      await writeSnapshot(db, date, summary, "[]");
    expect((await readSnapshots(db, 2)).map((s) => s.snapshotDate)).toEqual([
      "2026-09-15",
      "2026-09-16",
    ]);
    await db.close();
  });
  it("does not capture stale or previous-day data as today", async () => {
    const db = await createTestDb();
    expect(
      await maybeCreateSnapshot(
        db,
        { isStale: true } as PortfolioSummary,
        "[]",
        new Date("2026-09-15T21:00:00Z"),
      ),
    ).toBe(false);
    await db.close();
  });
  it("preserves the original note and appends another member contribution", async () => {
    const db = await createTestDb();
    await addToWatchlist(db, {
      symbol: "AAPL",
      reason: "Original idea",
      addedBy: "Father",
    });
    await addToWatchlist(db, {
      symbol: "aapl",
      reason: "Another view",
      addedBy: "Mother",
    });
    const entry = (await readWatchlist(db))[0];
    expect(entry.addedBy).toBe("Father");
    expect(entry.reason).toBe("Original idea");
    expect(entry.notes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ author: "Mother", body: "Another view" }),
      ]),
    );
    await db.close();
  });
});

describe("snapshot timestamp integrity", () => {
  it("rejects intraday data received after the market closes", async () => {
    const db = await createTestDb();
    const summary = {
      isStale: false,
      dataTimestamp: "2026-09-15T19:45:00Z",
      totalMarketValue: { amount: "100", currency: "USD" },
      totalCostBasis: { amount: "100", currency: "USD" },
      totalUnrealizedPnL: { amount: "0", currency: "USD" },
      cashValue: { amount: "0", currency: "USD" },
    } as PortfolioSummary;
    expect(
      await maybeCreateSnapshot(db, summary, "[]", new Date("2026-09-15T20:05:00Z")),
    ).toBe(false);
    await db.close();
  });
});

describe("analysis data lifecycle", () => {
  it("requires new confirmation after changing or removing a cash flow", async () => {
    const { saveAnalysis, readAnalysis } = await import("@/lib/analysis/store");
    const db = await createTestDb();
    await saveAnalysis(
      db,
      { action: "review", from: "2026-01-01", to: "2026-01-02" },
      "owner",
    );
    expect((await readAnalysis(db)).coverage).not.toBeNull();
    const after = await saveAnalysis(
      db,
      { action: "flow", date: "2026-01-02", amount: 100, note: "deposit" },
      "owner",
    );
    expect(after.coverage).toBeNull();
    await saveAnalysis(
      db,
      { action: "review", from: "2026-01-01", to: "2026-01-02" },
      "owner",
    );
    expect(
      (await saveAnalysis(
        db,
        { action: "removeFlow", id: after.flows[0].id! },
        "owner",
      )).coverage,
    ).toBeNull();
    await db.close();
  });
  it("normalizes benchmark and portfolio to their first common date", async () => {
    const { benchmarkComparison } = await import("@/lib/analysis/math");
    const points = adjustedSeries(
      [
        snap("2026-09-14", 100),
        snap("2026-09-15", 110),
        snap("2026-09-16", 121),
      ],
      [],
      review,
    ).points;
    const comparison = benchmarkComparison(points, [
      { date: "2026-09-15", value: 200 },
      { date: "2026-09-16", value: 210 },
    ]);
    expect(comparison[0]).toEqual({
      date: "2026-09-15",
      portfolio: 100,
      benchmark: 100,
    });
    expect(comparison[1].portfolio).toBeCloseTo(110, 10);
    expect(comparison[1].benchmark).toBe(105);
  });
  it("rejects cross-origin browser mutations", async () => {
    const { rejectCrossOrigin } = await import("@/lib/http/origin");
    expect(
      rejectCrossOrigin(
        new Request("https://portfolio.example/api/analysis", {
          headers: { Origin: "https://attacker.example" },
        }),
      )?.status,
    ).toBe(403);
    expect(
      rejectCrossOrigin(
        new Request("https://portfolio.example/api/analysis", {
          headers: { Origin: "https://portfolio.example" },
        }),
      ),
    ).toBeNull();
  });
});

it("accepts the configured public origin behind a reverse proxy", async () => {
  const { rejectCrossOrigin } = await import("@/lib/http/origin");
  vi.stubEnv("APP_URL", "https://portfolio.example");
  try {
    expect(
      rejectCrossOrigin(
        new Request("http://internal:3000/api/family", {
          headers: {
            Origin: "https://portfolio.example",
            Host: "internal:3000",
          },
        }),
      ),
    ).toBeNull();
    expect(
      rejectCrossOrigin(
        new Request("http://internal:3000/api/family", {
          headers: {
            Origin: "https://attacker.example",
            Host: "internal:3000",
          },
        }),
      )?.status,
    ).toBe(403);
  } finally {
    vi.unstubAllEnvs();
  }
});
