import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, TEST_PORTFOLIO_ID, type TestDb } from "@/lib/db/testing";
import { readPositions, syncPositions } from "@/lib/portfolio/sync";
import { getQuotes } from "@/lib/portfolio/quotes";
import { MockBrokerProvider } from "@/providers/broker/mock";
import { MockMarketDataProvider } from "@/providers/market-data/mock";
import type { MarketDataProvider } from "@/providers/market-data/types";
import type { Quote } from "@/types/market";

/** Scoping is exercised in portfolios.test.ts; here it only has to be real. */
const PF = TEST_PORTFOLIO_ID;

let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
});

afterEach(async () => {
  await db.close();
});

function quote(symbol: string, price: number): Quote {
  return {
    symbol,
    price,
    previousClose: price - 1,
    change: 1,
    changePercent: 1,
    marketStatus: "regular",
    dataTimestamp: new Date().toISOString(),
    source: "test",
  };
}

describe("mock broker provider", () => {
  it("returns the synthetic portfolio from the specification", async () => {
    const positions = await new MockBrokerProvider().getPositions();
    const symbols = positions.map((p) => p.symbol);

    expect(symbols).toContain("AAPL");
    expect(symbols).toContain("GOOGL");
    expect(symbols).toContain("VST");
    expect(symbols).toContain("RBLX");
    expect(positions.some((p) => p.instrumentType === "option")).toBe(true);
    expect(positions.some((p) => p.instrumentType === "cash")).toBe(true);
  });
});

describe("position sync", () => {
  it("writes the broker's positions into the database", async () => {
    const count = await syncPositions(db, PF, new MockBrokerProvider(), "mock");
    expect(count).toBeGreaterThan(0);
    expect(await readPositions(db, PF)).toHaveLength(count);
  });

  it("replaces rather than appends on a second sync", async () => {
    await syncPositions(db, PF, new MockBrokerProvider(), "mock");
    const first = (await readPositions(db, PF)).length;
    await syncPositions(db, PF, new MockBrokerProvider(), "mock");
    expect(await readPositions(db, PF)).toHaveLength(first);
  });

  it("preserves option contract metadata through the round trip", async () => {
    await syncPositions(db, PF, new MockBrokerProvider(), "mock");
    const option = (await readPositions(db, PF)).find(
      (p) => p.instrumentType === "option",
    );

    expect(option).toBeDefined();
    expect(option?.contractMultiplier).toBe(100);
    expect(option?.optionType).toBe("call");
    expect(option?.underlyingSymbol).toBe("AAPL");
  });

  it("leaves the stored portfolio untouched when the broker fails", async () => {
    await syncPositions(db, PF, new MockBrokerProvider(), "mock");
    const before = (await readPositions(db, PF)).length;

    const failing = {
      getAccounts: async () => [],
      getPositions: async () => {
        throw new Error("broker unavailable");
      },
      getAccountSummary: async () => {
        throw new Error("broker unavailable");
      },
      getTransactions: async () => [],
    };

    await expect(syncPositions(db, PF, failing, "mock")).rejects.toThrow();
    expect(await readPositions(db, PF)).toHaveLength(before);
  });
});

describe("quote cache", () => {
  it("calls the provider on a cold cache and serves the second read from cache", async () => {
    const getQuotesSpy = vi.fn(async (symbols: string[]) =>
      symbols.map((s) => quote(s, 100)),
    );
    const provider: MarketDataProvider = {
      getQuotes: getQuotesSpy,
      getHistoricalPrices: async () => [],
    };

    const now = new Date("2026-09-18T14:00:00Z");
    await getQuotes(db, ["AAPL"], provider, now);
    await getQuotes(db, ["AAPL"], provider, new Date(now.getTime() + 5_000));

    expect(getQuotesSpy).toHaveBeenCalledTimes(1);
  });

  it("refetches once the entry ages past its TTL", async () => {
    const getQuotesSpy = vi.fn(async (symbols: string[]) =>
      symbols.map((s) => quote(s, 100)),
    );
    const provider: MarketDataProvider = {
      getQuotes: getQuotesSpy,
      getHistoricalPrices: async () => [],
    };

    const now = new Date("2026-09-18T14:00:00Z");
    await getQuotes(db, ["AAPL"], provider, now);
    await getQuotes(db, ["AAPL"], provider, new Date(now.getTime() + 60_000));

    expect(getQuotesSpy).toHaveBeenCalledTimes(2);
  });

  it("falls back to the last known quote and flags staleness on provider failure", async () => {
    const now = new Date("2026-09-18T14:00:00Z");
    const working: MarketDataProvider = {
      getQuotes: async (symbols) => symbols.map((s) => quote(s, 123)),
      getHistoricalPrices: async () => [],
    };
    await getQuotes(db, ["AAPL"], working, now);

    const broken: MarketDataProvider = {
      getQuotes: async () => {
        throw new Error("upstream down");
      },
      getHistoricalPrices: async () => [],
    };

    const result = await getQuotes(
      db,
      ["AAPL"],
      broken,
      new Date(now.getTime() + 600_000),
    );

    expect(result.isStale).toBe(true);
    expect(result.quotes.get("AAPL")?.price).toBe(123);
  });
});

describe("mock market data", () => {
  it("produces a history series that ends at the live price", async () => {
    const prices = await new MockMarketDataProvider().getHistoricalPrices("AAPL", {
      from: "2026-08-01",
      to: "2026-09-18",
    });

    expect(prices.length).toBeGreaterThan(10);
    expect(prices[prices.length - 1].close).toBeCloseTo(195.2, 2);
  });

  it("is deterministic across calls", async () => {
    const provider = new MockMarketDataProvider();
    const range = { from: "2026-08-01", to: "2026-09-18" };
    const a = await provider.getHistoricalPrices("AAPL", range);
    const b = await provider.getHistoricalPrices("AAPL", range);
    expect(a).toEqual(b);
  });

  it("skips weekends", async () => {
    const prices = await new MockMarketDataProvider().getHistoricalPrices("AAPL", {
      from: "2026-09-14",
      to: "2026-09-20",
    });
    expect(prices.map((p) => p.date)).toEqual([
      "2026-09-14",
      "2026-09-15",
      "2026-09-16",
      "2026-09-17",
      "2026-09-18",
    ]);
  });
});
