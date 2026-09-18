import { describe, expect, it } from "vitest";
import type { Position } from "@/types/portfolio";
import {
  allocationByAssetType,
  buildPositionViews,
  concentration,
  contractMultiplier,
  costBasis,
  daysToExpiration,
  marketValue,
  summarize,
  todayPnL,
  totalMarketValue,
  unrealizedPnL,
} from "@/lib/portfolio";

function position(overrides: Partial<Position>): Position {
  return {
    id: overrides.id ?? "p1",
    broker: "mock",
    instrumentType: "stock",
    symbol: "TEST",
    quantity: 10,
    averageCost: 100,
    currentPrice: 110,
    previousClose: 105,
    currency: "USD",
    lastUpdatedAt: "2026-09-18T00:00:00.000Z",
    ...overrides,
  };
}

const MARKET = {
  status: "regular" as const,
  dataTimestamp: "2026-09-18T14:00:00.000Z",
  isStale: false,
};

describe("stock position maths", () => {
  const stock = position({});

  it("computes market value, cost and unrealized P&L", () => {
    expect(marketValue(stock).amount.toFixed()).toBe("1100");
    expect(costBasis(stock).amount.toFixed()).toBe("1000");
    expect(unrealizedPnL(stock).amount.toFixed()).toBe("100");
  });

  it("computes today's P&L from the previous close", () => {
    expect(todayPnL(stock).amount.toFixed()).toBe("50");
  });
});

describe("option contract multiplier", () => {
  const option = position({
    id: "opt",
    instrumentType: "option",
    symbol: "AAPL270115C00200000",
    optionType: "call",
    quantity: 2,
    averageCost: 12.4,
    currentPrice: 18.65,
    previousClose: 17.9,
    contractMultiplier: 100,
  });

  it("scales every notional figure by the multiplier", () => {
    expect(marketValue(option).amount.toFixed()).toBe("3730");
    expect(costBasis(option).amount.toFixed()).toBe("2480");
    expect(unrealizedPnL(option).amount.toFixed()).toBe("1250");
    expect(todayPnL(option).amount.toFixed()).toBe("150");
  });

  it("defaults to 100 when the broker omits the multiplier", () => {
    const withoutMultiplier = { ...option, contractMultiplier: undefined };
    expect(contractMultiplier(withoutMultiplier).toNumber()).toBe(100);
    expect(marketValue(withoutMultiplier).amount.toFixed()).toBe("3730");
  });

  it("never applies a multiplier to a stock", () => {
    expect(contractMultiplier(position({})).toNumber()).toBe(1);
  });
});

describe("cash", () => {
  const cash = position({
    id: "cash",
    instrumentType: "cash",
    symbol: "USD.CASH",
    quantity: 5000,
    averageCost: 1,
    currentPrice: undefined,
    previousClose: undefined,
  });

  it("values at face and never reports a gain or loss", () => {
    expect(marketValue(cash).amount.toFixed()).toBe("5000");
    expect(costBasis(cash).amount.toFixed()).toBe("5000");
    expect(unrealizedPnL(cash).amount.toFixed()).toBe("0");
    expect(todayPnL(cash).amount.toFixed()).toBe("0");
  });
});

describe("missing quotes", () => {
  it("values an unpriced position at zero instead of NaN", () => {
    const unpriced = position({ currentPrice: undefined, previousClose: undefined });
    expect(marketValue(unpriced).amount.toFixed()).toBe("0");
    expect(todayPnL(unpriced).amount.toFixed()).toBe("0");
  });
});

describe("portfolio aggregation", () => {
  const positions = [
    position({ id: "a", symbol: "AAA", quantity: 10, averageCost: 100, currentPrice: 110, previousClose: 105 }),
    position({ id: "b", symbol: "BBB", quantity: 20, averageCost: 50, currentPrice: 45, previousClose: 46 }),
    position({
      id: "c",
      symbol: "USD.CASH",
      instrumentType: "cash",
      quantity: 400,
      averageCost: 1,
      currentPrice: undefined,
      previousClose: undefined,
    }),
  ];

  it("totals market value across positions including cash", () => {
    // 1100 + 900 + 400
    expect(totalMarketValue(positions, "USD").amount.toFixed()).toBe("2400");
  });

  it("weights sum to 100 percent", () => {
    const views = buildPositionViews(positions, "USD");
    const totalWeight = views.reduce((acc, v) => acc + v.weightPercent, 0);
    expect(totalWeight).toBeCloseTo(100, 6);
  });

  it("orders views by market value descending", () => {
    const views = buildPositionViews(positions, "USD");
    expect(views.map((v) => v.symbol)).toEqual(["AAA", "BBB", "USD.CASH"]);
  });

  it("summarises totals and cash share", () => {
    const summary = summarize(positions, "USD", MARKET);
    expect(summary.totalMarketValue.amount).toBe("2400");
    expect(summary.totalCostBasis.amount).toBe("2400");
    expect(summary.totalUnrealizedPnL.amount).toBe("0");
    expect(summary.cashValue.amount).toBe("400");
    expect(summary.cashPercent).toBeCloseTo(16.6667, 3);
    expect(summary.positionCount).toBe(2);
  });

  it("nets today's P&L across gainers and losers", () => {
    // AAA +50, BBB -20
    expect(summarize(positions, "USD", MARKET).todayPnL.amount).toBe("30");
  });

  it("excludes cash from concentration", () => {
    const result = concentration(positions, "USD");
    // 1100 of 2000 invested
    expect(result.top1Percent).toBeCloseTo(55, 6);
    expect(result.top3Percent).toBeCloseTo(100, 6);
  });

  it("groups allocation by asset type", () => {
    const slices = allocationByAssetType(positions, "USD");
    expect(slices.map((s) => s.key)).toEqual(["stock", "cash"]);
    expect(slices[0].percent).toBeCloseTo(83.3333, 3);
  });
});

describe("days to expiration", () => {
  it("counts whole days from the given date", () => {
    expect(daysToExpiration("2026-01-16", new Date("2026-01-01T12:00:00Z"))).toBe(15);
    expect(daysToExpiration("2026-01-01", new Date("2026-01-01T23:00:00Z"))).toBe(0);
  });
});
