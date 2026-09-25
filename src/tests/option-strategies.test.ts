import { describe, expect, it } from "vitest";
import { candidates, chanceAbove, type ChainQuote } from "@/lib/options/strategies";

// A share at 100, a month to go, strikes every 5 with a plain smile of prices.
const SPOT = 100;
const YEARS = 30 / 365;
const q = (type: "call" | "put", strike: number, bid: number, ask: number, iv = 0.4): ChainQuote => ({
  symbol: `XYZ${type === "call" ? "C" : "P"}${strike}`,
  type,
  strike,
  bid,
  ask,
  iv,
  multiplier: 100,
});
const CHAIN: ChainQuote[] = [
  q("put", 85, 0.3, 0.4),
  q("put", 90, 0.8, 0.9),
  q("put", 95, 1.9, 2.0),
  q("put", 100, 4.4, 4.6),
  q("put", 105, 7.9, 8.2),
  q("call", 95, 7.4, 7.7),
  q("call", 100, 4.5, 4.7),
  q("call", 105, 2.3, 2.4),
  q("call", 110, 1.0, 1.1),
  q("call", 115, 0.4, 0.5),
];

describe("selling a put", () => {
  it("counts the bid, the cash set aside and where it breaks even", () => {
    const list = candidates("sell-put", CHAIN, SPOT, YEARS);
    const p95 = list.find((c) => c.legs[0].strike === 95)!;
    expect(p95.legs[0]).toMatchObject({ side: "sell", price: 1.9 });
    expect(p95.breakEven).toBeCloseTo(93.1, 9);
    expect(p95.maxProfit).toBeCloseTo(190, 9);
    expect(p95.capital).toBe(9500);
    expect(p95.maxLoss).toBeCloseTo(9310, 9);
    expect(p95.annualReturn).toBeCloseTo(190 / 9500 / YEARS, 9);
  });

  it("only offers strikes below the share price, as likely to pay as asked", () => {
    const list = candidates("sell-put", CHAIN, SPOT, YEARS);
    expect(list.every((c) => c.legs[0].strike < SPOT)).toBe(true);
    expect(list.every((c) => (c.chance ?? 1) >= 0.7)).toBe(true);

    // Asking for more certainty leaves fewer, and never adds a riskier one.
    const surer = candidates("sell-put", CHAIN, SPOT, YEARS, 8, 0.9);
    expect(surer.every((c) => (c.chance ?? 1) >= 0.9)).toBe(true);
    expect(surer.length).toBeLessThanOrEqual(list.length);
  });
});

describe("spreads", () => {
  it("prices a bull call spread: buy the lower at the ask, sell the higher at the bid", () => {
    const spread = candidates("bull-call-spread", CHAIN, SPOT, YEARS, 50).find(
      (c) => c.legs[0].strike === 100 && c.legs[1].strike === 105,
    )!;
    expect(spread.legs.map((l) => [l.side, l.price])).toEqual([
      ["buy", 4.7],
      ["sell", 2.3],
    ]);
    expect(spread.net).toBeCloseTo(-2.4, 9);
    expect(spread.maxLoss).toBeCloseTo(240, 9);
    expect(spread.maxProfit).toBeCloseTo(260, 9);
    expect(spread.breakEven).toBeCloseTo(102.4, 9);
  });

  it("prices a bull put spread as a credit with a capped loss", () => {
    const spread = candidates("bull-put-spread", CHAIN, SPOT, YEARS, 50, 0).find(
      (c) => c.legs[0].strike === 90 && c.legs[1].strike === 95,
    )!;
    // Buy the 90 at 0.90, sell the 95 at 1.90: a dollar a share in.
    expect(spread.net).toBeCloseTo(1.0, 9);
    expect(spread.maxProfit).toBeCloseTo(100, 9);
    expect(spread.maxLoss).toBeCloseTo(400, 9);
    expect(spread.breakEven).toBeCloseTo(94, 9);
  });

  it("puts the break-even of a bear put spread below the bought strike", () => {
    const spread = candidates("bear-put-spread", CHAIN, SPOT, YEARS, 50).find(
      (c) => c.legs[0].strike === 100 && c.legs[1].strike === 95,
    )!;
    // Buy the 100 at 4.60, sell the 95 at 1.90.
    expect(spread.net).toBeCloseTo(-2.7, 9);
    expect(spread.breakEven).toBeCloseTo(97.3, 9);
  });

  it("puts the break-even of a bear call spread above the sold strike", () => {
    const spread = candidates("bear-call-spread", CHAIN, SPOT, YEARS, 50, 0).find(
      (c) => c.legs[1].strike === 105 && c.legs[0].strike === 110,
    )!;
    // Sell the 105 at 2.30, buy the 110 at 1.10.
    expect(spread.net).toBeCloseTo(1.2, 9);
    expect(spread.breakEven).toBeCloseTo(106.2, 9);
    expect(spread.chance).toBeGreaterThan(0.5);
  });
});

describe("buying one option", () => {
  it("has no ceiling on a call, and starts at the money", () => {
    const list = candidates("buy-call", CHAIN, SPOT, YEARS);
    expect(list[0].maxProfit).toBeNull();
    expect(list[0].legs[0].strike).toBe(100);
    const distance = list.map((c) => Math.abs(c.legs[0].strike - SPOT));
    expect([...distance].sort((a, b) => a - b)).toEqual(distance);
  });

  it("gives no yearly return on a bought spread, where it means nothing", () => {
    const list = candidates("bull-call-spread", CHAIN, SPOT, YEARS);
    expect(list.every((c) => c.annualReturn === null)).toBe(true);
  });

  it("skips a contract nobody is offering", () => {
    const list = candidates("buy-call", [{ ...CHAIN[6], ask: undefined }], SPOT, YEARS);
    expect(list).toEqual([]);
  });
});

describe("the chance figure", () => {
  it("is a half at the money and moves the right way", () => {
    expect(chanceAbove(100, 100, YEARS, 0.4)).toBeGreaterThan(0.45);
    expect(chanceAbove(100, 100, YEARS, 0.4)).toBeLessThan(0.5);
    expect(chanceAbove(100, 90, YEARS, 0.4)).toBeGreaterThan(chanceAbove(100, 110, YEARS, 0.4));
  });
});
