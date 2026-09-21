import { describe, expect, it } from "vitest";
import {
  realizedByFill,
  realizedBySymbol,
  reconstruct,
  type PriceSeries,
} from "@/lib/portfolio/reconstruct";
import { parseSymbol } from "@/lib/moomoo/symbols";
import type { BrokerTransaction } from "@/types/broker";

function fill(
  date: string,
  side: "buy" | "sell",
  symbol: string,
  quantity: number,
  price: number,
): BrokerTransaction {
  // Same rule the replay uses, so a fixture's recorded amount cannot quietly
  // disagree with the quantity and price beside it.
  const multiplier = parseSymbol(symbol).instrumentType === "option" ? 100 : 1;
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

describe("realized per symbol", () => {
  it("attributes a profit to the name that earned it, even once sold out", () => {
    const bySymbol = realizedBySymbol([
      fill("2026-06-01", "buy", "AAA", 10, 100),
      fill("2026-06-02", "sell", "AAA", 10, 110),
    ]);
    expect(bySymbol.get("AAA")).toBeCloseTo(100, 6);
  });

  it("keeps names apart", () => {
    const bySymbol = realizedBySymbol([
      fill("2026-06-01", "buy", "AAA", 10, 100),
      fill("2026-06-01", "buy", "BBB", 10, 50),
      fill("2026-06-02", "sell", "AAA", 10, 110),
      fill("2026-06-02", "sell", "BBB", 10, 45),
    ]);
    expect(bySymbol.get("AAA")).toBeCloseTo(100, 6);
    expect(bySymbol.get("BBB")).toBeCloseTo(-50, 6);
  });

  it("omits a name that has only ever been bought", () => {
    expect(realizedBySymbol([fill("2026-06-01", "buy", "AAA", 10, 100)]).has("AAA")).toBe(false);
  });

  it("sums to the same realized the full replay reports", () => {
    const fills = [
      fill("2026-06-01", "buy", "AAA", 10, 100),
      fill("2026-06-02", "sell", "AAA", 4, 110),
      fill("2026-06-02", "sell", "BBB260101C00100000", 1, 8),
      fill("2026-06-03", "buy", "BBB260101C00100000", 1, 6),
    ];
    const perSymbol = [...realizedBySymbol(fills).values()].reduce((a, b) => a + b, 0);
    const replayed = reconstruct(fills, [], prices({}), days);
    expect(perSymbol).toBeCloseTo(replayed[replayed.length - 1].realized.toNumber(), 6);
  });
});

describe("option contract size", () => {
  // The symbols below are the real ones held in the account. An earlier local
  // pattern required a zero-padded eight-digit strike and matched none of
  // them, so every option was replayed as if it were a single share.
  const OPTIONS = [
    "GOOGL270319C350000",
    "GOOGL270319C380000",
    "INTC270115P92500",
    "NBIS261218C200000",
    "UUUU280121C10000",
    "VRT270319C280000",
  ];
  const SHARES = ["ASTS", "AVGO", "GOOGL", "NVDA", "XE", "INV", "FLY"];

  it("values a bought contract at a hundred times the quoted price", () => {
    const days = reconstruct(
      [fill("2026-06-03", "buy", "GOOGL270319C350000", 1, 30)],
      [{ date: "2026-06-02", amount: 10_000 }],
      new Map([["GOOGL270319C350000", new Map([["2026-06-03", 30]])]]),
      ["2026-06-02", "2026-06-03"],
    );

    const last = days[days.length - 1];
    // 10,000 paid in, 3,000 spent on the contract, 3,000 of contract held.
    expect(last.cash.toNumber()).toBeCloseTo(7_000, 2);
    expect(last.costBasis.toNumber()).toBeCloseTo(3_000, 2);
    expect(last.marketValue.toNumber()).toBeCloseTo(10_000, 2);
    expect(last.totalReturn.toNumber()).toBeCloseTo(0, 2);
  });

  it("treats every option this account holds as a hundred-share contract", () => {
    for (const symbol of OPTIONS) {
      const days = reconstruct(
        [fill("2026-06-03", "buy", symbol, 1, 10)],
        [{ date: "2026-06-02", amount: 5_000 }],
        new Map([[symbol, new Map([["2026-06-03", 10]])]]),
        ["2026-06-02", "2026-06-03"],
      );
      expect(days[days.length - 1].cash.toNumber(), symbol).toBeCloseTo(4_000, 2);
    }
  });

  it("leaves ordinary shares at one", () => {
    for (const symbol of SHARES) {
      const days = reconstruct(
        [fill("2026-06-03", "buy", symbol, 1, 10)],
        [{ date: "2026-06-02", amount: 5_000 }],
        new Map([[symbol, new Map([["2026-06-03", 10]])]]),
        ["2026-06-02", "2026-06-03"],
      );
      expect(days[days.length - 1].cash.toNumber(), symbol).toBeCloseTo(4_990, 2);
    }
  });

  it("scales realized profit on a closed contract too", () => {
    const realized = realizedBySymbol([
      fill("2026-06-03", "buy", "VRT270319C280000", 2, 20),
      fill("2026-07-01", "sell", "VRT270319C280000", 2, 32),
    ]);
    // 12 of price improvement, two contracts, a hundred shares each.
    expect(realized.get("VRT270319C280000")).toBeCloseTo(2_400, 2);
  });
});

describe("attributing realized profit to the trade that took it", () => {
  it("credits the sale, not the purchase", () => {
    const { byDeal } = realizedByFill([
      fill("2026-06-03", "buy", "NVDA", 10, 200),
      fill("2026-07-01", "sell", "NVDA", 4, 250),
    ]);

    const buy = "2026-06-03-NVDA-buy-10";
    const sell = "2026-07-01-NVDA-sell-4";

    expect(byDeal.get(buy)).toBeUndefined();
    expect(byDeal.get(sell)).toBeCloseTo(200, 6);
  });

  it("adds up to the per-symbol totals", () => {
    const fills = [
      fill("2026-06-03", "buy", "NVDA", 10, 200),
      fill("2026-06-10", "buy", "NVDA", 10, 220),
      fill("2026-07-01", "sell", "NVDA", 5, 250),
      fill("2026-07-15", "sell", "NVDA", 5, 180),
    ];

    const { byDeal, bySymbol } = realizedByFill(fills);
    const summed = [...byDeal.values()].reduce((total, value) => total + value, 0);

    expect(summed).toBeCloseTo(bySymbol.get("NVDA")!, 6);
    expect(realizedBySymbol(fills).get("NVDA")).toBeCloseTo(summed, 6);
  });

  it("scales a closed option contract by a hundred", () => {
    const { byDeal } = realizedByFill([
      fill("2026-06-03", "buy", "VRT270319C280000", 1, 20),
      fill("2026-07-01", "sell", "VRT270319C280000", 1, 32),
    ]);
    expect(byDeal.get("2026-07-01-VRT270319C280000-sell-1")).toBeCloseTo(1_200, 6);
  });
});
