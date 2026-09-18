import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import {
  add,
  formatMoney,
  formatPercent,
  money,
  percentOf,
  subtract,
  sum,
  toDTO,
  zero,
} from "@/lib/money";

describe("money arithmetic", () => {
  it("adds without binary floating point drift", () => {
    const total = sum([money("0.1", "USD"), money("0.2", "USD")], "USD");
    expect(total.amount.toFixed()).toBe("0.3");
  });

  it("keeps precision across a long accumulation", () => {
    const items = Array.from({ length: 1000 }, () => money("0.01", "USD"));
    expect(sum(items, "USD").amount.toFixed()).toBe("10");
  });

  it("refuses to mix currencies", () => {
    expect(() => add(money(1, "USD"), money(1, "SGD"))).toThrow(/Currency mismatch/);
    expect(() => subtract(money(1, "USD"), money(1, "CNY"))).toThrow(
      /Currency mismatch/,
    );
  });

  it("returns null rather than Infinity when the base is zero", () => {
    expect(percentOf(money(5, "USD"), zero("USD"))).toBeNull();
  });

  it("serialises as a lossless string", () => {
    const dto = toDTO(money(new Decimal("12345.678901234567"), "USD"));
    expect(dto).toEqual({ amount: "12345.678901234567", currency: "USD" });
  });
});

describe("formatting", () => {
  it("signs positive and negative amounts explicitly", () => {
    expect(formatMoney({ amount: "1234.5", currency: "USD" }, { signed: true })).toBe(
      "+$1,234.50",
    );
    expect(formatMoney({ amount: "-1234.5", currency: "USD" }, { signed: true })).toBe(
      "-$1,234.50",
    );
  });

  it("renders an em dash for an unknown percentage", () => {
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(Number.NaN)).toBe("—");
  });
});
