import { describe, expect, it } from "vitest";
import { pnlByHolding } from "@/lib/portfolio/chart-data";
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
