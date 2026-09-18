import { describe, expect, it } from "vitest";
import type { Position } from "@/types/portfolio";
import { groupOptions, totalInvested } from "@/lib/portfolio/options";

function leg(overrides: Partial<Position> & { symbol: string }): Position {
  return {
    id: overrides.symbol,
    broker: "moomoo",
    instrumentType: "option",
    optionType: "call",
    currency: "USD",
    contractMultiplier: 100,
    quantity: 1,
    lastUpdatedAt: "2026-09-18T00:00:00.000Z",
    ...overrides,
  };
}

// The real bull call spread from the connected account.
const NBIS_LONG = leg({
  symbol: "NBIS261218C200000",
  underlyingSymbol: "NBIS",
  expirationDate: "2026-12-18",
  strike: 200,
  quantity: 2,
  reportedMarketValue: 9294.84,
  reportedUnrealizedPnL: 534.84,
  reportedTodayPnL: 0,
});

const NBIS_SHORT = leg({
  symbol: "NBIS261218C240000",
  underlyingSymbol: "NBIS",
  expirationDate: "2026-12-18",
  strike: 240,
  quantity: -2,
  reportedMarketValue: -5962.08,
  reportedUnrealizedPnL: -382.08,
  reportedTodayPnL: 0,
});

describe("bull call spread", () => {
  const { groups } = groupOptions([NBIS_LONG, NBIS_SHORT]);
  const spread = groups[0];

  it("collapses both legs into one position", () => {
    expect(groups).toHaveLength(1);
    expect(spread.legs).toHaveLength(2);
    expect(spread.strategy).toBe("call-spread");
    expect(spread.underlying).toBe("NBIS");
  });

  // Reporting the legs apart showed a $9.3k long call for a $3.2k position.
  it("nets the cost of the two legs", () => {
    expect(Number(spread.netCost.amount)).toBeCloseTo(3180, 2);
  });

  it("nets the market value of the two legs", () => {
    expect(Number(spread.netMarketValue.amount)).toBeCloseTo(3332.76, 2);
  });

  it("nets unrealized P&L across the legs", () => {
    expect(Number(spread.unrealizedPnL.amount)).toBeCloseTo(152.76, 2);
  });

  it("caps profit at the strike width less the debit paid", () => {
    // (240 - 200) x 100 x 2 = 8000 width, less 3180 paid
    expect(Number(spread.maxProfit?.amount)).toBeCloseTo(4820, 2);
  });

  it("caps loss at the debit paid", () => {
    expect(Number(spread.maxLoss?.amount)).toBeCloseTo(-3180, 2);
  });

  it("breaks even at the lower strike plus the debit per share", () => {
    expect(spread.breakEven).toBeCloseTo(215.9, 2);
  });
});

describe("other real spreads", () => {
  it("prices the VRT spread", () => {
    const { groups } = groupOptions([
      leg({
        symbol: "VRT270319C230000",
        underlyingSymbol: "VRT",
        expirationDate: "2027-03-19",
        strike: 230,
        quantity: 1,
        reportedMarketValue: 4927.37,
        reportedUnrealizedPnL: 84.37,
      }),
      leg({
        symbol: "VRT270319C280000",
        underlyingSymbol: "VRT",
        expirationDate: "2027-03-19",
        strike: 280,
        quantity: -1,
        reportedMarketValue: -2877.52,
        reportedUnrealizedPnL: 15.48,
      }),
    ]);

    expect(Number(groups[0].netCost.amount)).toBeCloseTo(1950, 2);
    expect(Number(groups[0].maxProfit?.amount)).toBeCloseTo(3050, 2);
    expect(groups[0].breakEven).toBeCloseTo(249.5, 2);
  });

  it("prices the UUUU spread", () => {
    const { groups } = groupOptions([
      leg({
        symbol: "UUUU280121C10000",
        underlyingSymbol: "UUUU",
        expirationDate: "2028-01-21",
        strike: 10,
        quantity: 6,
        reportedMarketValue: 2987.4,
        reportedUnrealizedPnL: -294.6,
      }),
      leg({
        symbol: "UUUU280121C20000",
        underlyingSymbol: "UUUU",
        expirationDate: "2028-01-21",
        strike: 20,
        quantity: -6,
        reportedMarketValue: -1583.22,
        reportedUnrealizedPnL: 78.78,
      }),
    ]);

    expect(Number(groups[0].netCost.amount)).toBeCloseTo(1620, 2);
    expect(Number(groups[0].maxProfit?.amount)).toBeCloseTo(4380, 2);
    expect(groups[0].breakEven).toBeCloseTo(12.7, 2);
  });
});

describe("single-leg options", () => {
  it("leaves a long call's upside unbounded and caps its loss at the premium", () => {
    const { groups } = groupOptions([
      leg({
        symbol: "AAPL270115C00200000",
        underlyingSymbol: "AAPL",
        expirationDate: "2027-01-15",
        strike: 200,
        quantity: 2,
        reportedMarketValue: 3730,
        reportedUnrealizedPnL: 1250,
      }),
    ]);

    expect(groups[0].strategy).toBe("long-call");
    expect(groups[0].maxProfit).toBeNull();
    expect(Number(groups[0].maxLoss?.amount)).toBeCloseTo(-2480, 2);
    expect(groups[0].breakEven).toBeCloseTo(212.4, 2);
  });

  it("leaves an uncovered short call's loss unbounded", () => {
    const { groups } = groupOptions([
      leg({
        symbol: "TSLA270115C00500000",
        underlyingSymbol: "TSLA",
        expirationDate: "2027-01-15",
        strike: 500,
        quantity: -1,
        reportedMarketValue: -1000,
        reportedUnrealizedPnL: 0,
      }),
    ]);

    expect(groups[0].strategy).toBe("short-call");
    expect(groups[0].maxLoss).toBeNull();
    expect(Number(groups[0].maxProfit?.amount)).toBeCloseTo(1000, 2);
  });
});

describe("invested capital", () => {
  it("counts a spread once, at net cost", () => {
    const stock: Position = {
      id: "s",
      broker: "moomoo",
      instrumentType: "stock",
      symbol: "AAA",
      quantity: 10,
      averageCost: 100,
      currency: "USD",
      lastUpdatedAt: "2026-09-18T00:00:00.000Z",
    };

    const invested = totalInvested([NBIS_LONG, NBIS_SHORT, stock], "USD");
    // 3180 net spread cost + 1000 stock — not 8760 for the long leg alone
    expect(Number(invested.amount)).toBeCloseTo(4180, 2);
  });

  it("ignores cash", () => {
    const cash: Position = {
      id: "c",
      broker: "moomoo",
      instrumentType: "cash",
      symbol: "USD.CASH",
      quantity: 5000,
      averageCost: 1,
      currency: "USD",
      lastUpdatedAt: "2026-09-18T00:00:00.000Z",
    };
    expect(totalInvested([cash], "USD").amount.toFixed()).toBe("0");
  });
});
