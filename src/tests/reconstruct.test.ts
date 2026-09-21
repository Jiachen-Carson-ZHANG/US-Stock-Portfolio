import { describe, expect, it } from "vitest";
import { reconstruct, type PriceSeries } from "@/lib/portfolio/reconstruct";
import type { BrokerTransaction } from "@/types/broker";

function fill(
  date: string,
  side: "buy" | "sell",
  symbol: string,
  quantity: number,
  price: number,
): BrokerTransaction {
  const multiplier = /\d{6}[CP]\d{8}$/.test(symbol) ? 100 : 1;
  return {
    dealId: `${date}-${symbol}-${side}-${quantity}`,
    orderId: "",
    side,
    symbol,
    quantity,
    price,
    amount: quantity * price * multiplier * (side === "buy" ? -1 : 1),
    tradedAt: `${date}T14:00:00.000Z`,
  };
}

const prices = (rows: Record<string, Record<string, number>>): PriceSeries =>
  new Map(Object.entries(rows).map(([s, d]) => [s, new Map(Object.entries(d))]));

const days = ["2026-06-01", "2026-06-02", "2026-06-03"];

describe("replaying the account", () => {
  it("does not read a deposit as a gain", () => {
    // The whole reason dates are needed: cash and deposits move together.
    const out = reconstruct([], [{ date: "2026-06-02", amount: 1000 }], prices({}), days);
    expect(out[0].totalReturn.toNumber()).toBe(0);
    expect(out[1].cash.toNumber()).toBe(1000);
    expect(out[1].totalReturn.toNumber()).toBe(0);
  });

  it("carries an unrealized gain without touching realized", () => {
    const out = reconstruct(
      [fill("2026-06-01", "buy", "AAA", 10, 100)],
      [{ date: "2026-06-01", amount: 1000 }],
      prices({ AAA: { "2026-06-01": 100, "2026-06-02": 110, "2026-06-03": 110 } }),
      days,
    );
    expect(out[1].unrealized.toNumber()).toBe(100);
    expect(out[1].realized.toNumber()).toBe(0);
    expect(out[1].totalReturn.toNumber()).toBe(100);
  });

  it("moves the gain from unrealized to realized on the sale, leaving the total alone", () => {
    const out = reconstruct(
      [fill("2026-06-01", "buy", "AAA", 10, 100), fill("2026-06-02", "sell", "AAA", 10, 110)],
      [{ date: "2026-06-01", amount: 1000 }],
      prices({ AAA: { "2026-06-01": 100, "2026-06-02": 110, "2026-06-03": 110 } }),
      days,
    );
    expect(out[1].realized.toNumber()).toBe(100);
    expect(out[1].unrealized.toNumber()).toBe(0);
    expect(out[1].totalReturn.toNumber()).toBe(100);
    expect(out[1].cash.toNumber()).toBe(1100);
  });

  it("realizes only the part actually sold", () => {
    const out = reconstruct(
      [fill("2026-06-01", "buy", "AAA", 10, 100), fill("2026-06-02", "sell", "AAA", 4, 110)],
      [{ date: "2026-06-01", amount: 1000 }],
      prices({ AAA: { "2026-06-01": 100, "2026-06-02": 110, "2026-06-03": 110 } }),
      days,
    );
    expect(out[1].realized.toNumber()).toBe(40);
    expect(out[1].unrealized.toNumber()).toBe(60);
    expect(out[1].totalReturn.toNumber()).toBe(100);
  });

  it("handles a written option: credit on open, realized on buy-back", () => {
    // Sold to open at 8.00, bought back at 6.00 — a $200 gain on one contract.
    const out = reconstruct(
      [
        fill("2026-06-01", "sell", "AAA260101C00100000", 1, 8),
        fill("2026-06-02", "buy", "AAA260101C00100000", 1, 6),
      ],
      [],
      prices({ AAA260101C00100000: { "2026-06-01": 8, "2026-06-02": 6, "2026-06-03": 6 } }),
      days,
    );
    expect(out[0].cash.toNumber()).toBe(800);
    expect(out[0].unrealized.toNumber()).toBe(0);
    expect(out[1].realized.toNumber()).toBe(200);
    expect(out[1].totalReturn.toNumber()).toBe(200);
  });

  it("applies the contract multiplier to option value", () => {
    const out = reconstruct(
      [fill("2026-06-01", "buy", "AAA260101C00100000", 2, 5)],
      [{ date: "2026-06-01", amount: 5000 }],
      prices({ AAA260101C00100000: { "2026-06-01": 5, "2026-06-02": 7, "2026-06-03": 7 } }),
      days,
    );
    // 2 contracts x 100 x (7 - 5)
    expect(out[1].unrealized.toNumber()).toBe(400);
  });

  it("holds the last close through a day with no price", () => {
    const out = reconstruct(
      [fill("2026-06-01", "buy", "AAA", 10, 100)],
      [{ date: "2026-06-01", amount: 1000 }],
      prices({ AAA: { "2026-06-01": 100, "2026-06-03": 120 } }),
      days,
    );
    expect(out[1].marketValue.toNumber()).toBe(1000);
    expect(out[2].marketValue.toNumber()).toBe(1200);
  });

  it("keeps value = deposits + realized + unrealized every single day", () => {
    const out = reconstruct(
      [
        fill("2026-06-01", "buy", "AAA", 10, 100),
        fill("2026-06-02", "sell", "AAA", 4, 110),
        fill("2026-06-02", "buy", "BBB", 5, 50),
      ],
      [{ date: "2026-06-01", amount: 1000 }, { date: "2026-06-03", amount: 500 }],
      prices({
        AAA: { "2026-06-01": 100, "2026-06-02": 110, "2026-06-03": 105 },
        BBB: { "2026-06-02": 50, "2026-06-03": 60 },
      }),
      days,
    );
    for (const day of out) {
      const identity = day.netDeposits.plus(day.realized).plus(day.unrealized);
      expect(identity.toNumber()).toBeCloseTo(day.marketValue.toNumber(), 8);
    }
  });
});

describe("deposits that land off the series", () => {
  const weekdays = ["2026-09-17", "2026-09-18", "2026-09-21"]; // Thu, Fri, Mon

  it("carries a weekend deposit to the next day rather than losing it", () => {
    // Saturday is not a trading day, and adding it would break the weekday run
    // the daily statistics need. Keying by exact date would drop the money.
    const out = reconstruct([], [{ date: "2026-09-19", amount: 2000 }], prices({}), weekdays);
    expect(out[1].netDeposits.toNumber()).toBe(0);
    expect(out[2].netDeposits.toNumber()).toBe(2000);
    expect(out[2].cash.toNumber()).toBe(2000);
    expect(out[2].totalReturn.toNumber()).toBe(0);
  });

  it("keeps a deposit made before the series begins", () => {
    const out = reconstruct([], [{ date: "2026-01-01", amount: 500 }], prices({}), weekdays);
    expect(out[0].netDeposits.toNumber()).toBe(500);
  });

  it("never silently drops money", () => {
    const flows = [
      { date: "2026-09-19", amount: 2000 },
      { date: "2026-09-20", amount: 300 },
      { date: "2026-09-17", amount: 100 },
    ];
    const out = reconstruct([], flows, prices({}), weekdays);
    expect(out[out.length - 1].netDeposits.toNumber()).toBe(2400);
  });
});
