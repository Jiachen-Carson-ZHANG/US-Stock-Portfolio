import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDbForTests } from "@/lib/db";
import { createTestDb, type TestDb } from "@/lib/db/testing";
import { rankAcross, type Candidate } from "@/lib/options/strategies";
import { screenAll } from "@/lib/options/screen";
import type { MarketDataProvider } from "@/providers/market-data/types";
import type { OptionContract, Quote } from "@/types/market";

const candidate = (over: Partial<Candidate>): Candidate => ({
  legs: [{ symbol: "X", side: "sell", type: "put", strike: 95, price: 1 }],
  net: 1,
  maxProfit: 100,
  maxLoss: 9_400,
  breakEven: 94,
  chance: 0.8,
  capital: 9_500,
  annualReturn: 0.1,
  multiplier: 100,
  ...over,
});

describe("ranking across every expiry", () => {
  it("ranks money collected now by income per year, among those likely enough", () => {
    const list = [
      candidate({ annualReturn: 0.3, chance: 0.6 }),
      candidate({ annualReturn: 0.2, chance: 0.75 }),
      candidate({ annualReturn: 0.1, chance: 0.9 }),
    ];
    expect(rankAcross("sell-put", list, "best", 0.7).map((c) => c.annualReturn)).toEqual([0.2, 0.1]);
  });

  it("ranks a bought spread by what it can make for each dollar it can lose", () => {
    const list = [candidate({ maxProfit: 200, maxLoss: 300, chance: 0.4 }), candidate({ maxProfit: 400, maxLoss: 100, chance: 0.4 })];
    expect(rankAcross("bull-call-spread", list, "best", 0.35)[0].maxProfit).toBe(400);
  });

  it("ranks a single bought option by how little it costs", () => {
    const list = [candidate({ capital: 900, chance: 0.4 }), candidate({ capital: 300, chance: 0.4 }), candidate({ capital: 100, chance: 0.2 })];
    expect(rankAcross("buy-call", list, "best", 0.35).map((c) => c.capital)).toEqual([300, 900]);
  });
});

describe("searching every expiry", () => {
  const SPOT = 100;
  const DATES = [
    { date: "2026-10-09", days: 11 },
    { date: "2026-11-20", days: 53 },
    { date: "2027-06-18", days: 263 },
  ];
  const chainFor = (expiry: string): OptionContract[] =>
    [80, 85, 90, 95, 100, 105].map((strike) => ({
      symbol: `XYZ${expiry.slice(2).replaceAll("-", "")}P${strike * 1000}`,
      type: "put" as const,
      strike,
      expiry,
      multiplier: 100,
    }));
  const quote = (symbol: string, price: number): Quote => ({
    symbol, price, previousClose: price, change: 0, changePercent: 0, marketStatus: "regular",
    dataTimestamp: new Date().toISOString(), source: "test",
    raw: { bid_price: price, ask_price: price + 0.05 },
    greeks: { impliedVolatility: 0.4 } as Quote["greeks"],
  });
  const asked: string[] = [];
  const provider: MarketDataProvider = {
    async getQuotes(symbols) {
      return symbols.map((symbol) => {
        if (symbol === "XYZ") return quote(symbol, SPOT);
        const strike = Number(symbol.slice(-5)) / 1000;
        const far = symbol.includes("2706") ? 3 : symbol.includes("2611") ? 1.6 : 0.8;
        return quote(symbol, Math.max(0.05, (SPOT - strike) * 0.02 + far * (strike / SPOT)));
      });
    },
    async getHistoricalPrices() { return []; },
    async getOptionExpirations() { return DATES; },
    async getOptionChain(_symbol, expiry) { asked.push(expiry); return chainFor(expiry); },
  };

  let db: TestDb;
  beforeEach(async () => {
    db = await createTestDb();
    resetDbForTests(db);
    asked.length = 0;
  });
  afterEach(async () => {
    resetDbForTests(null);
    await db.close();
  });

  it("searches only the dates inside the horizon and ranks them together", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-28T14:00:00Z"));
    try {
      const result = await screenAll(db, provider, {
        symbol: "XYZ", spot: SPOT, expirations: DATES, strategy: "sell-put",
        horizonDays: 60, minChance: 0.5, sort: "best", now: new Date(),
      });
      expect(result.expiries).toBe(2);
      expect(asked.sort()).toEqual(["2026-10-09", "2026-11-20"]);
      expect(result.candidates.length).toBeGreaterThan(0);
      expect(new Set(result.candidates.map((c) => c.expiry)).size).toBeGreaterThan(0);
      const incomes = result.candidates.map((c) => c.annualReturn ?? 0);
      expect(incomes).toEqual([...incomes].sort((a, b) => b - a));
    } finally {
      vi.useRealTimers();
    }
  });
});
