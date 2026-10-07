import { describe, expect, it } from "vitest";
import { pnlByHolding, returnByHolding } from "@/lib/portfolio/chart-data";
import type { OptionGroupDTO } from "@/lib/portfolio/options";
import type { PositionView } from "@/types/portfolio";

const usd = (amount: number) => ({ amount: String(amount), currency: "USD" });

function leg(id: string, symbol: string, unrealized: number): PositionView {
  return {
    id,
    broker: "moomoo",
    instrumentType: "option",
    symbol,
    quantity: 1,
    currency: "USD",
    lastUpdatedAt: "2026-09-20T00:00:00.000Z",
    marketValue: usd(0),
    costBasis: usd(0),
    unrealizedPnL: usd(unrealized),
    unrealizedPnLPercent: 0,
    todayPnL: usd(0),
    todayPnLPercent: 0,
    weightPercent: 0,
  } as PositionView;
}

function stock(id: string, symbol: string, unrealized: number): PositionView {
  return { ...leg(id, symbol, unrealized), instrumentType: "stock" };
}

// The real NBIS spread: two legs that all but cancel.
const long = leg("l1", "NBIS261218C200000", 1246.8);
const short = leg("l2", "NBIS261218C240000", -995);
const group = {
  id: "g1",
  underlying: "NBIS",
  expirationDate: "2026-12-18",
  strategy: "call-spread",
  legs: [long, short],
  netCost: usd(3180),
  netMarketValue: usd(3431.8),
  unrealizedPnL: usd(251.8),
  todayPnL: usd(0),
  maxProfit: null,
  maxLoss: null,
  breakEven: null,
  weightPercent: 0,
} as unknown as OptionGroupDTO;

const pick = (p: PositionView) => Number(p.unrealizedPnL.amount);
const pickGroup = (g: OptionGroupDTO) => Number(g.unrealizedPnL.amount);

describe("P&L by holding", () => {
  it("nets a spread into one bar instead of charting both legs", () => {
    const data = pnlByHolding([long, short], [group], pick, pickGroup);
    expect(data).toHaveLength(1);
    expect(data[0]).toEqual({ symbol: "NBIS 2026-12-18", value: 251.8 });
  });

  it("never shows a leg as its own holding", () => {
    const data = pnlByHolding([long, short], [group], pick, pickGroup);
    const symbols = data.map((d) => d.symbol);
    expect(symbols).not.toContain("NBIS261218C200000");
    expect(symbols).not.toContain("NBIS261218C240000");
  });

  it("keeps ordinary holdings and sorts by value", () => {
    const winner = stock("s1", "AAA", 500);
    const loser = stock("s2", "BBB", -700);
    const data = pnlByHolding([winner, long, short, loser], [group], pick, pickGroup);
    expect(data.map((d) => d.symbol)).toEqual([
      "AAA",
      "NBIS 2026-12-18",
      "BBB",
    ]);
  });

  it("drops cash and anything flat", () => {
    const cash = { ...stock("c", "USD.CASH", 0), instrumentType: "cash" as const };
    const flat = stock("f", "FLAT", 0);
    expect(pnlByHolding([cash, flat], [], pick, pickGroup)).toEqual([]);
  });
});

const L = { closed: "closed", other: "Other", options: "{symbol} options" };

describe("return by holding", () => {
  it("shows both halves and sorts by the combined result", () => {
    const held = stock("s1", "AAA", 100);
    const other = stock("s2", "BBB", 400);
    const rows = returnByHolding([held, other], { AAA: 50 }, 0, L);
    expect(rows.map((r) => r.symbol)).toEqual(["BBB", "AAA"]);
    expect(rows[1]).toMatchObject({ unrealized: 100, realized: 50, total: 150 });
  });

  it("sums a spread's realized across its legs", () => {
    const rows = returnByHolding([long, short], { [long.symbol]: 10, [short.symbol]: 5 }, 0, L);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ symbol: "NBIS options", realized: 15 });
    expect(rows[0].unrealized).toBeCloseTo(251.8, 6);
  });

  it("counts closed contracts on one stock as one result", () => {
    // The two APP call spreads opened on 30 Sep and closed on 5 Oct. Shown
    // contract by contract they read as two large losses and two gains.
    const rows = returnByHolding(
      [],
      {
        APP261030C300000: -2494,
        APP261030C330000: 1254,
        APP261030C295000: -2808,
        APP261030C325000: 1544,
      },
      0,
      L,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].symbol).toBe("APP options · closed");
    expect(rows[0].total).toBeCloseTo(-2504, 6);
  });

  it("joins open and closed options on one stock across expiry dates", () => {
    const rows = returnByHolding([long, short], { NBIS260918C150000: -300 }, 0, L);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ symbol: "NBIS options", realized: -300 });
    expect(rows[0].unrealized).toBeCloseTo(251.8, 6);
    expect(rows[0].total).toBeCloseTo(-48.2, 6);
  });

  it("keeps shares apart from the options written on them", () => {
    const rows = returnByHolding(
      [stock("s1", "VRT", 100), leg("o1", "VRT270319C230000", 50)],
      {},
      0,
      L,
    );
    expect(rows.map((r) => r.symbol)).toEqual(["VRT", "VRT options"]);
  });

  it("gives holdings since sold a row of their own, so the bars still total", () => {
    // Without it the $949 banked on closed names silently leaves the chart.
    const held = stock("s1", "AAA", -1358.46);
    const rows = returnByHolding([held], { AAA: 380.1 }, 948.77, L);
    const total = rows.reduce((n, r) => n + r.total, 0);
    expect(total).toBeCloseTo(-29.59, 2);
    expect(rows.some((r) => r.symbol === "Other")).toBe(true);
  });

  it("omits the closed row when there is nothing banked outside current holdings", () => {
    const rows = returnByHolding([stock("s1", "AAA", 10)], {}, 0, L);
    expect(rows.map((r) => r.symbol)).toEqual(["AAA"]);
  });
});
