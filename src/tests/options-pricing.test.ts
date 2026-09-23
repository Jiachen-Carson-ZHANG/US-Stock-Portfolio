import { describe, expect, it } from "vitest";
import {
  blackScholes,
  impliedVol,
  valueToday,
  yearsUntil,
  type PricedLeg,
} from "@/lib/analysis/options-pricing";

describe("what an option is worth before it expires", () => {
  it("collapses to the payoff once there is no time left", () => {
    expect(blackScholes("call", 120, 100, 0, 0.04, 0.4)).toBeCloseTo(20, 6);
    expect(blackScholes("call", 80, 100, 0, 0.04, 0.4)).toBe(0);
    expect(blackScholes("put", 80, 100, 0, 0.04, 0.4)).toBeCloseTo(20, 6);
  });

  it("is worth more than the payoff while time remains", () => {
    const now = blackScholes("call", 120, 100, 0.5, 0.04, 0.4);
    expect(now).toBeGreaterThan(20);
  });

  it("agrees with a published value", () => {
    // S=100, K=100, T=1, r=5%, vol=20% is the worked example in every
    // textbook: 10.4506.
    expect(blackScholes("call", 100, 100, 1, 0.05, 0.2)).toBeCloseTo(10.4506, 3);
  });

  it("satisfies put-call parity, which is arithmetic rather than a model", () => {
    const call = blackScholes("call", 105, 100, 0.75, 0.03, 0.35);
    const put = blackScholes("put", 105, 100, 0.75, 0.03, 0.35);
    expect(call - put).toBeCloseTo(105 - 100 * Math.exp(-0.03 * 0.75), 6);
  });
});

describe("reading volatility back out of a price", () => {
  it("recovers the volatility a price was made with", () => {
    const price = blackScholes("call", 210, 200, 0.25, 0.04, 0.55);
    expect(impliedVol(price, "call", 210, 200, 0.25, 0.04)).toBeCloseTo(0.55, 3);
  });

  it("recovers it for a contract deep in the money, where the slope is flat", () => {
    const price = blackScholes("call", 300, 100, 0.2, 0.04, 0.45);
    const solved = impliedVol(price, "call", 300, 100, 0.2, 0.04);
    expect(solved).not.toBeNull();
    expect(blackScholes("call", 300, 100, 0.2, 0.04, solved!)).toBeCloseTo(price, 4);
  });

  it("refuses a price below what the contract would pay out today", () => {
    // 5 for a call 20 in the money is not a price, it is a bad quote.
    expect(impliedVol(5, "call", 120, 100, 0.25, 0.04)).toBeNull();
  });

  it("refuses a price no volatility could produce", () => {
    expect(impliedVol(500, "call", 100, 100, 0.25, 0.04)).toBeNull();
  });
});

describe("the position valued as it stands", () => {
  const legs: PricedLeg[] = [
    { type: "call", strike: 200, quantity: 2, multiplier: 100, premium: 59.36, vol: 0.5 },
    { type: "call", strike: 240, quantity: -2, multiplier: 100, premium: 39.88, vol: 0.5 },
  ];

  it("beats the expiry payoff while the spread still has time", () => {
    // Below the lower strike a call spread pays nothing at expiry, but it is
    // not worthless today — which is the entire reason for this curve.
    const paid = (59.36 - 39.88) * 2 * 100;
    const today = valueToday(legs, 150, 0.25, 0.04, 0)!;
    expect(today).toBeGreaterThan(-paid);
    expect(today).toBeLessThan(0);
  });

  it("gives no answer when a leg has no usable quote", () => {
    const unsolved = [legs[0], { ...legs[1], vol: null }];
    expect(valueToday(unsolved, 220, 0.25, 0.04, 0)).toBeNull();
  });

  it("takes fees off the top", () => {
    const withoutFees = valueToday(legs, 220, 0.25, 0.04, 0)!;
    expect(valueToday(legs, 220, 0.25, 0.04, 25)).toBeCloseTo(withoutFees - 25, 6);
  });
});

describe("time to expiry", () => {
  it("is zero once the day has passed", () => {
    expect(yearsUntil("2020-01-17", new Date("2026-09-23T12:00:00Z"))).toBe(0);
  });

  it("counts roughly the days that remain", () => {
    const years = yearsUntil("2026-12-18", new Date("2026-09-23T12:00:00Z"));
    expect(Math.round(years * 365.25)).toBe(86);
  });
});
