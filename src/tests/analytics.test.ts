import { describe, expect, it } from "vitest";
import {
  annualisedVolatilityPercent,
  maxDrawdownPercent,
  statsFor,
} from "@/lib/portfolio/analytics";
import type { PortfolioSnapshot } from "@/types/portfolio";

function snapshot(date: string, value: number): PortfolioSnapshot {
  return {
    snapshotDate: date,
    totalMarketValue: String(value),
    totalCost: "100",
    totalUnrealizedPnL: String(value - 100),
    cashValue: "0",
  };
}

describe("max drawdown", () => {
  it("measures the largest peak-to-trough decline", () => {
    expect(maxDrawdownPercent([100, 120, 90, 110])).toBeCloseTo(25, 6);
  });

  it("is zero for a monotonically rising series", () => {
    expect(maxDrawdownPercent([100, 110, 120])).toBe(0);
  });

  it("needs at least two points", () => {
    expect(maxDrawdownPercent([100])).toBeNull();
  });
});

describe("volatility", () => {
  it("is zero for a flat series", () => {
    expect(annualisedVolatilityPercent([100, 100, 100, 100])).toBeCloseTo(0, 9);
  });

  it("needs at least three points for two returns", () => {
    expect(annualisedVolatilityPercent([100, 110])).toBeNull();
  });
});

describe("series stats", () => {
  it("summarises a snapshot series", () => {
    const stats = statsFor([
      snapshot("2026-01-05", 100),
      snapshot("2026-01-06", 110),
      snapshot("2026-01-07", 99),
    ], [], { from: "2026-01-05", to: "2026-01-07" });

    expect(stats.periodReturnPercent).toBeCloseTo(-1, 6);
    expect(stats.maxDrawdownPercent).toBeCloseTo(10, 6);
    expect(stats.bestDayPercent).toBeCloseTo(10, 6);
    expect(stats.worstDayPercent).toBeCloseTo(-10, 6);
  });

  it("returns nulls when there is no history", () => {
    expect(statsFor([]).periodReturnPercent).toBeNull();
  });
});
