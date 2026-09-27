import { describe, expect, it } from "vitest";
import { tradedByPrice } from "@/lib/market/traded-by-price";

describe("where a share has changed hands", () => {
  it("puts a flat day's trading in the band it happened in", () => {
    const bands = tradedByPrice(
      [
        { close: 10, turnover: 100 },
        { close: 20, turnover: 300 },
      ],
      2,
    );
    expect(bands.map((b) => b.traded)).toEqual([100, 300]);
  });

  it("spreads a day across its range, and keeps every dollar", () => {
    const bands = tradedByPrice([{ close: 15, low: 10, high: 20, turnover: 1000 }], 4);
    expect(bands.map((b) => Math.round(b.traded))).toEqual([250, 250, 250, 250]);
    expect(bands.reduce((sum, b) => sum + b.traded, 0)).toBeCloseTo(1000, 9);
  });

  it("falls back to shares times price when money traded is missing", () => {
    const [band] = tradedByPrice([{ close: 5, volume: 10 }], 1);
    expect(band.traded).toBe(50);
  });

  it("has nothing to say about nothing", () => {
    expect(tradedByPrice([])).toEqual([]);
    expect(tradedByPrice([{ close: 5 }])).toEqual([]);
  });
});
