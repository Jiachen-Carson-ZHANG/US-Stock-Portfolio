import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "@/lib/db/testing";
import { getQuotes } from "@/lib/portfolio/quotes";
import type { MarketDataProvider } from "@/providers/market-data/types";
import type { Quote } from "@/types/market";

let db: TestDb;
const NOW = new Date("2026-09-23T14:00:00.000Z");

function quote(symbol: string, price: number): Quote {
  return {
    symbol,
    name: symbol,
    price,
    previousClose: price,
    change: 0,
    changePercent: 0,
    marketStatus: "regular",
    dataTimestamp: NOW.toISOString(),
    source: "test",
  };
}

function provider(behaviour: () => Promise<Quote[]>): MarketDataProvider {
  return {
    getQuotes: behaviour,
    getHistoricalPrices: async () => [],
  };
}

async function seedCache(symbol: string, price: number, cachedAt: Date) {
  await db.run(
    `INSERT INTO quote_cache
       (symbol, price, previous_close, change, change_percent,
        market_status, data_timestamp, source, cached_at)
     VALUES (?, ?, ?, 0, 0, 'regular', ?, 'test', ?)`,
    [symbol, price, price, cachedAt.toISOString(), cachedAt.toISOString()],
  );
}

beforeEach(async () => {
  db = await createTestDb();
});

afterEach(async () => {
  await db.close();
});

describe("a page must never wait on the broker when it has something to show", () => {
  it("serves an hour-old price rather than waiting for a feed that hangs", async () => {
    await seedCache("NVDA", 180, new Date(NOW.getTime() - 3_600_000));

    // A feed that never answers. Before, anything past a minute old made the
    // caller wait for exactly this — which is how a page hung with a spinner
    // turning and no error anywhere.
    const hangs = provider(() => new Promise<Quote[]>(() => {}));

    const result = await Promise.race([
      getQuotes(db, ["NVDA"], hangs, NOW),
      new Promise((resolve) => setTimeout(() => resolve("waited"), 300)),
    ]);

    expect(result).not.toBe("waited");
    const { quotes, isStale } = result as Awaited<ReturnType<typeof getQuotes>>;
    expect(quotes.get("NVDA")?.price).toBe(180);
    // Served, and honest about being old.
    expect(isStale).toBe(true);
  });

  it("says nothing is stale when the cache is fresh", async () => {
    await seedCache("GOOGL", 180, new Date(NOW.getTime() - 2_000));

    const { quotes, isStale } = await getQuotes(
      db,
      ["GOOGL"],
      provider(async () => []),
      NOW,
    );

    expect(quotes.get("GOOGL")?.price).toBe(180);
    expect(isStale).toBe(false);
  });

  it("does wait when there is nothing at all to show", async () => {
    // A different symbol from the hanging test above on purpose: in-flight
    // fetches are shared by symbol list, so joining a request that never
    // answers would hang this one too. In the app that cannot last, because
    // every broker call carries a deadline — but the sharing is real and
    // worth not tripping over here.
    const fetched = vi.fn(async () => [quote("AMD", 200)]);

    const { quotes } = await getQuotes(db, ["AMD"], provider(fetched), NOW);

    expect(fetched).toHaveBeenCalled();
    expect(quotes.get("AMD")?.price).toBe(200);
  });

  it("keeps the last known price when the feed fails outright", async () => {
    await seedCache("EOSE", 180, new Date(NOW.getTime() - 120_000));

    const { quotes, isStale } = await getQuotes(
      db,
      ["EOSE"],
      provider(async () => {
        throw new Error("rate limited");
      }),
      NOW,
    );

    expect(quotes.get("EOSE")?.price).toBe(180);
    expect(isStale).toBe(true);
  });
});
