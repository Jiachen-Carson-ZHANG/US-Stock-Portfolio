import { describe, expect, it } from "vitest";
import type { Position } from "@/types/portfolio";
import { money } from "@/lib/money";
import {
  allocationByAssetType,
  allocationByPosition,
  buildPositionViews,
  concentration,
  contractMultiplier,
  costBasis,
  daysToExpiration,
  marketValue,
  shortExposure,
  summarize,
  todayPnL,
  totalMarketValue,
  unrealizedPnL,
} from "@/lib/portfolio";
import {
  allocationByAssetTypeAtCost,
  allocationBySectorAtCost,
} from "@/lib/portfolio/options";

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

describe("broker-reported figures", () => {
  // Real moomoo data: NVIDIA, partly sold, so realized proceeds have driven
  // cost_price negative. Deriving cost from it reports total P&L (+196) as if
  // it were unrealized; the true unrealized figure is +80.
  const partlySold = position({
    id: "nvda",
    symbol: "NVDA",
    quantity: 0.435,
    averageCost: -229.8851,
    currentPrice: 221.072,
    previousClose: 220,
    reportedPrice: 221.072,
    reportedMarketValue: 96.17,
    reportedUnrealizedPnL: 80.3362,
    reportedTodayPnL: 0.7533,
    reportedRealizedPnL: 115.83,
  });

  it("derives cost from the broker's own market value and unrealized P&L", () => {
    expect(Number(costBasis(partlySold).amount)).toBeCloseTo(15.8338, 4);
  });

  it("never reports realized gains as unrealized", () => {
    const unrealized = Number(unrealizedPnL(partlySold).amount);
    expect(unrealized).toBeCloseTo(80.33, 1);
    expect(unrealized).toBeLessThan(100);
  });

  it("prefers the broker's stated figure for today", () => {
    expect(Number(todayPnL(partlySold).amount)).toBeCloseTo(0.7533, 4);
  });

  it("falls back to the broker's market value when no quote has arrived", () => {
    const unpriced = { ...partlySold, currentPrice: undefined };
    expect(Number(marketValue(unpriced).amount)).toBeCloseTo(96.17, 2);
  });

  it("still derives cost from averageCost when the broker states nothing", () => {
    const plain = position({ quantity: 10, averageCost: 100 });
    expect(costBasis(plain).amount.toFixed()).toBe("1000");
  });
});

describe("short positions", () => {
  const shortCall = position({
    id: "short",
    symbol: "VRT270319C280000",
    instrumentType: "option",
    optionType: "call",
    quantity: -1,
    contractMultiplier: 100,
    averageCost: 28.93,
    currentPrice: 28.775,
    previousClose: 29,
    reportedPrice: 28.775,
    reportedMarketValue: -2877.52,
    reportedUnrealizedPnL: 15.48,
    reportedTodayPnL: 0,
  });

  const longStock = position({
    id: "long",
    symbol: "AAA",
    quantity: 10,
    averageCost: 100,
    currentPrice: 110,
    previousClose: 105,
  });

  const cash = position({
    id: "cash",
    symbol: "USD.CASH",
    instrumentType: "cash",
    quantity: 1000,
    averageCost: 1,
    currentPrice: undefined,
    previousClose: undefined,
  });

  const book = [longStock, shortCall, cash];

  it("values a written call as negative market value", () => {
    expect(Number(marketValue(shortCall).amount)).toBeCloseTo(-2877.5, 1);
  });

  it("shows a gain on a written call whose price has fallen", () => {
    expect(Number(unrealizedPnL(shortCall).amount)).toBeCloseTo(15.5, 1);
  });

  it("reports short exposure separately", () => {
    expect(Number(shortExposure(book, "USD").amount)).toBeCloseTo(-2877.5, 1);
  });

  it("reports zero short exposure for a long-only book", () => {
    expect(shortExposure([longStock, cash], "USD").amount.toFixed()).toBe("0");
  });

  // A part-to-whole chart cannot render a negative slice, and a short leg in
  // the denominator pushes concentration above 100%.
  it("keeps shorts out of the allocation breakdown", () => {
    const slices = allocationByPosition(book, "USD");
    expect(slices.map((s) => s.key)).not.toContain("VRT270319C280000");
    expect(slices.every((s) => Number(s.value) > 0)).toBe(true);
  });

  it("keeps allocation percentages summing to 100", () => {
    const total = allocationByPosition(book, "USD").reduce(
      (acc, s) => acc + s.percent,
      0,
    );
    expect(total).toBeCloseTo(100, 6);
  });

  it("keeps concentration at or below 100 percent", () => {
    const result = concentration(book, "USD");
    expect(result.top1Percent).toBeCloseTo(100, 6);
    expect(result.top5Percent).toBeLessThanOrEqual(100);
  });
});

describe("total return", () => {
  // Real figures from the connected account.
  const held = position({
    id: "held",
    symbol: "HELD",
    quantity: 1,
    currentPrice: 20187.61,
    previousClose: 20187.61,
    reportedMarketValue: 20187.61,
    reportedUnrealizedPnL: -1228.57,
    reportedRealizedPnL: 359.77,
  });

  const summary = summarize([held], "USD", MARKET);

  it("adds realized gains to the unrealized result", () => {
    expect(Number(summary.totalReturn.amount)).toBeCloseTo(-868.8, 2);
  });

  it("measures the return against the capital that produced it", () => {
    // 20,187.61 worth now on 21,056.41 put to work
    expect(summary.totalReturnPercent).toBeCloseTo(-4.126, 3);
  });

  it("reconciles: capital in, grown by the return, is today's value", () => {
    const capitalIn =
      Number(summary.totalMarketValue.amount) - Number(summary.totalReturn.amount);
    const grown = capitalIn * (1 + (summary.totalReturnPercent ?? 0) / 100);
    expect(grown).toBeCloseTo(Number(summary.totalMarketValue.amount), 2);
  });

  it("measures against stated deposits when they are known", () => {
    // The whole point: no reliance on the broker's realized figure, which
    // omits positions closed outright.
    const withDeposits = summarize([held], "USD", MARKET, money(22100, "USD"));
    expect(Number(withDeposits.totalReturn.amount)).toBeCloseTo(
      20187.61 - 22100,
      2,
    );
    expect(withDeposits.totalReturnPercent).toBeCloseTo(
      (20187.61 / 22100 - 1) * 100,
      6,
    );
    expect(withDeposits.netDeposits?.amount).toBe("22100");
  });

  it("ignores a zero or negative deposit figure and infers instead", () => {
    const zero = summarize([held], "USD", MARKET, money(0, "USD"));
    expect(zero.netDeposits).toBeNull();
    expect(Number(zero.totalReturn.amount)).toBeCloseTo(-868.8, 2);
  });

  it("makes the three figures on the summary cards add up", () => {
    // What the family reads is unrealized, realized and total return side by
    // side. If they do not sum, one of them is wrong — and it was realized,
    // because the broker omits positions closed outright.
    const withDeposits = summarize([held], "USD", MARKET, money(22100, "USD"));
    const unrealized = Number(withDeposits.totalUnrealizedPnL.amount);
    const realized = Number(withDeposits.realizedPnL.amount);
    const total = Number(withDeposits.totalReturn.amount);
    expect(unrealized + realized).toBeCloseTo(total, 6);
  });

  it("derives realized as the residual rather than trusting the broker", () => {
    const withDeposits = summarize([held], "USD", MARKET, money(22100, "USD"));
    // value 20,187.61 - deposits 22,100 - unrealized -1,228.57
    expect(Number(withDeposits.realizedPnL.amount)).toBeCloseTo(-683.82, 2);
    // the broker's own figure, which it replaces
    expect(Number(summary.realizedPnL.amount)).toBeCloseTo(359.77, 2);
  });

  it("uses one base so the percentages sum like the amounts do", () => {
    const withDeposits = summarize([held], "USD", MARKET, money(22100, "USD"));
    const u = withDeposits.totalUnrealizedPnLPercent ?? 0;
    const r = withDeposits.realizedPnLPercent ?? 0;
    expect(u + r).toBeCloseTo(withDeposits.totalReturnPercent ?? 0, 6);
  });

  it("reports no deposits when none are configured", () => {
    expect(summary.netDeposits).toBeNull();
  });

  it("equals unrealized P&L when nothing has been realized", () => {
    const plain = summarize(
      [position({ quantity: 10, averageCost: 100, currentPrice: 110 })],
      "USD",
      MARKET,
    );
    expect(plain.totalReturn.amount).toBe(plain.totalUnrealizedPnL.amount);
  });
});

describe("days to expiration", () => {
  it("counts whole days from the given date", () => {
    expect(daysToExpiration("2026-01-16", new Date("2026-01-01T12:00:00Z"))).toBe(15);
    expect(daysToExpiration("2026-01-01", new Date("2026-01-01T23:00:00Z"))).toBe(0);
  });
});

describe("allocation weighted by cost", () => {
  // The bug this replaces: a call spread's long leg was counted at full
  // notional and its short leg dropped, so $3.2k of committed capital
  // presented as $26k and options looked like 65% of a portfolio they were
  // a third of.
  function spreadPortfolio(): Position[] {
    return [
      position({
        symbol: "VRT270319C230000",
        instrumentType: "option",
        underlyingSymbol: "VRT",
        optionType: "call",
        strike: 230,
        expirationDate: "2027-03-19",
        contractMultiplier: 100,
        quantity: 1,
        averageCost: 40,
        currentPrice: 52,
        sector: "Technology",
      }),
      position({
        symbol: "VRT270319C280000",
        instrumentType: "option",
        underlyingSymbol: "VRT",
        optionType: "call",
        strike: 280,
        expirationDate: "2027-03-19",
        contractMultiplier: 100,
        quantity: -1,
        averageCost: 24,
        currentPrice: 32,
        sector: "Technology",
      }),
      position({
        symbol: "NVDA",
        instrumentType: "stock",
        quantity: 10,
        averageCost: 200,
        currentPrice: 222,
        sector: "Technology",
      }),
      position({
        symbol: "USD",
        instrumentType: "cash",
        quantity: 400,
        averageCost: undefined,
        currentPrice: undefined,
      }),
    ];
  }

  it("counts a spread once, at what it cost", () => {
    const slices = allocationByAssetTypeAtCost(spreadPortfolio(), "USD");
    const options = slices.find((slice) => slice.key === "option");

    // 1 contract long at 40 minus 1 short at 24, times a hundred shares.
    expect(Number(options?.value)).toBeCloseTo(1_600, 2);
  });

  it("puts the slices in proportion to capital committed", () => {
    const slices = allocationByAssetTypeAtCost(spreadPortfolio(), "USD");
    const by = Object.fromEntries(slices.map((slice) => [slice.key, slice]));

    // 1,600 of options, 2,000 of stock, 400 of cash — 4,000 in all.
    expect(Number(by.option.value)).toBeCloseTo(1_600, 2);
    expect(Number(by.stock.value)).toBeCloseTo(2_000, 2);
    expect(Number(by.cash.value)).toBeCloseTo(400, 2);
    expect(by.stock.percent).toBeCloseTo(50, 4);
    expect(by.option.percent).toBeCloseTo(40, 4);
    expect(by.cash.percent).toBeCloseTo(10, 4);
  });

  it("adds to a hundred per cent", () => {
    const total = allocationByAssetTypeAtCost(spreadPortfolio(), "USD").reduce(
      (sum, slice) => sum + slice.percent,
      0,
    );
    expect(total).toBeCloseTo(100, 6);
  });

  it("gives an option the sector of its underlying", () => {
    const slices = allocationBySectorAtCost(spreadPortfolio(), "USD");
    expect(slices).toHaveLength(1);
    expect(slices[0].label).toBe("Technology");
    // Cash has no sector, so it is absent rather than counted as one.
    expect(Number(slices[0].value)).toBeCloseTo(3_600, 2);
  });
});
