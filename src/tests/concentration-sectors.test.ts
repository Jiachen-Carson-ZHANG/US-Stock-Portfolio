import { describe, expect, it } from "vitest";
import type { Position } from "@/types/portfolio";
import { concentration } from "@/lib/portfolio";
import { sectorFromSic } from "@/lib/market/sectors";

function position(overrides: Partial<Position>): Position {
  return {
    id: overrides.id ?? overrides.symbol ?? "p",
    broker: "mock",
    instrumentType: "stock",
    symbol: "TEST",
    quantity: 1,
    averageCost: 100,
    currentPrice: 100,
    previousClose: 100,
    currency: "USD",
    lastUpdatedAt: "2026-09-18T00:00:00.000Z",
    ...overrides,
  };
}

describe("concentration by company", () => {
  // A call spread on NBIS: long leg worth 11,600, short leg worth -7,600, so
  // 4,000 is really at stake. Plus 6,000 of GOOGL shares and a GOOGL call.
  const book = [
    position({ id: "a", symbol: "NBIS261218C200000", instrumentType: "option", underlyingSymbol: "NBIS", quantity: 2, currentPrice: 58, contractMultiplier: 100 }),
    position({ id: "b", symbol: "NBIS261218C240000", instrumentType: "option", underlyingSymbol: "NBIS", quantity: -2, currentPrice: 38, contractMultiplier: 100 }),
    position({ id: "c", symbol: "GOOGL", quantity: 20, currentPrice: 300 }),
    position({ id: "d", symbol: "GOOGL270319C350000", instrumentType: "option", underlyingSymbol: "GOOGL", quantity: 1, currentPrice: 20, contractMultiplier: 100 }),
  ];

  it("counts options under their company, with a spread's legs netted", () => {
    const result = concentration(book, "USD");
    expect(result.top?.map((row) => row.symbol)).toEqual(["GOOGL", "NBIS"]);
    // GOOGL 6,000 + 2,000 = 8,000; NBIS 11,600 - 7,600 = 4,000; of 12,000.
    expect(result.top?.[0].percent).toBeCloseTo(66.67, 1);
    expect(result.top?.[1].percent).toBeCloseTo(33.33, 1);
    expect(result.top?.every((row) => row.options)).toBe(true);
    expect(result.top1Percent).toBeCloseTo(66.67, 1);
  });
});

describe("industry from the SEC's code", () => {
  it("folds real companies' codes into plain sectors", () => {
    const cases: [string, number, string][] = [
      ["AAPL", 3571, "technology"],
      ["NVDA", 3674, "technology"],
      ["GOOGL", 7370, "technology"],
      ["VST", 4911, "utilities"],
      ["MCD", 5812, "consumer"],
      ["TSLA", 3711, "consumer"],
      ["RKLB", 3760, "industrials"],
      ["ASTS", 4899, "communication"],
      ["UUUU", 1400, "materials"],
      ["JNJ", 2834, "healthcare"],
      ["XOM", 2911, "energy"],
      ["JPM", 6021, "financials"],
      ["O", 6798, "realEstate"],
      ["PG", 2840, "consumer"],
    ];
    for (const [, sic, sector] of cases) expect(sectorFromSic(sic)).toBe(sector);
  });
});
