import { describe, expect, it } from "vitest";
import { payoffProfile, type PayoffLeg } from "@/lib/analysis/math";

const call = (strike: number, premium: number, quantity: number): PayoffLeg => ({
  type: "call",
  strike,
  premium,
  quantity,
  multiplier: 100,
});
const put = (strike: number, premium: number, quantity: number): PayoffLeg => ({
  type: "put",
  strike,
  premium,
  quantity,
  multiplier: 100,
});

describe("break-even, best and worst case at expiry", () => {
  it("reads a bull call spread: capped both ways", () => {
    // The NBIS spread from the screenshot: bought 2 x 200 calls at 43.80,
    // sold 2 x 240 calls at 27.90. Net 15.90 a share paid.
    const profile = payoffProfile([call(200, 43.8, 2), call(240, 27.9, -2)]);

    expect(profile.breakEvens).toEqual([215.9]);
    expect(profile.maxLoss).toBeCloseTo(-3180, 6);
    expect(profile.maxProfit).toBeCloseTo((40 - 15.9) * 200, 6);
  });

  it("knows a bought call can make without limit", () => {
    const profile = payoffProfile([call(100, 5, 1)]);
    expect(profile.maxProfit).toBe(Infinity);
    expect(profile.maxLoss).toBeCloseTo(-500, 6);
    expect(profile.breakEvens).toEqual([105]);
  });

  it("knows a sold call can lose without limit", () => {
    const profile = payoffProfile([call(100, 5, -1)]);
    expect(profile.maxLoss).toBe(-Infinity);
    expect(profile.maxProfit).toBeCloseTo(500, 6);
  });

  it("reads a sold put: best case the premium, worst case the share going to zero", () => {
    const profile = payoffProfile([put(50, 2, -1)]);
    expect(profile.maxProfit).toBeCloseTo(200, 6);
    expect(profile.maxLoss).toBeCloseTo(-(50 - 2) * 100, 6);
    expect(profile.breakEvens).toEqual([48]);
  });

  it("finds both break-evens of a long straddle", () => {
    const profile = payoffProfile([call(100, 4, 1), put(100, 3, 1)]);
    expect(profile.breakEvens).toEqual([93, 107]);
  });

  it("takes fees off every outcome", () => {
    const profile = payoffProfile([call(100, 5, 1)], 10);
    expect(profile.maxLoss).toBeCloseTo(-510, 6);
    expect(profile.breakEvens).toEqual([105.1]);
  });
});
