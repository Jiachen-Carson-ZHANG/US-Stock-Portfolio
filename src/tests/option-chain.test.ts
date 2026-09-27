import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDbForTests } from "@/lib/db";
import { createTestDb, type TestDb } from "@/lib/db/testing";
import type { MarketDataProvider } from "@/providers/market-data/types";
import type { OptionContract, Quote } from "@/types/market";

/**
 * The option chain page: which contracts get priced, and what a reader sees
 * when the share has no options or is not one the broker knows.
 */

const SPOT = 100;
const EXPIRY = "2026-10-16";
const STRIKES = [60, 70, 80, 90, 95, 100, 105, 110, 120, 130, 140];

const contract = (type: "call" | "put", strike: number): OptionContract => ({
  symbol: `XYZ261016${type === "call" ? "C" : "P"}${String(strike * 1000).padStart(8, "0")}`,
  type,
  strike,
  expiry: EXPIRY,
  multiplier: 100,
});
const CHAIN = STRIKES.flatMap((strike) => [contract("call", strike), contract("put", strike)]);

const quote = (symbol: string, price: number, raw: Record<string, unknown> = {}): Quote => ({
  symbol,
  price,
  previousClose: price,
  change: 0,
  changePercent: 0,
  marketStatus: "regular",
  dataTimestamp: new Date().toISOString(),
  source: "test",
  raw,
});

/** A broker that knows XYZ and its options, and nothing else. */
function broker(): MarketDataProvider & { expirationsAsked: number } {
  const provider = {
    expirationsAsked: 0,
    async getQuotes(symbols: string[]) {
      return symbols.flatMap((symbol) =>
        symbol === "XYZ"
          ? [quote("XYZ", SPOT)]
          : symbol.startsWith("XYZ2")
            ? [quote(symbol, 2.5, { bid_price: 2.4, ask_price: "2.6", volume: 0 })]
            : [],
      );
    },
    async getHistoricalPrices() {
      return [];
    },
    async getOptionExpirations() {
      provider.expirationsAsked += 1;
      return [{ date: EXPIRY, days: 21 }];
    },
    async getOptionChain() {
      return CHAIN;
    },
  };
  return provider;
}

const mocks = vi.hoisted(() => ({
  provider: null as MarketDataProvider | null,
  signedIn: true,
}));
vi.mock("@/lib/portfolios/context", () => ({
  requirePortfolioApi: async (slug: string | undefined) =>
    !mocks.signedIn
      ? { response: Response.json({ error: "Authentication required" }, { status: 401 }) }
      : !slug
        ? { response: Response.json({ error: "Say which portfolio" }, { status: 400 }) }
        : {
            user: { id: "u1", username: "u1", displayName: "U", role: "viewer" },
            portfolio: { id: "pf-1", slug, ownerUserId: "u1" },
          },
}));
vi.mock("@/providers", () => ({
  activeProvider: () => "moomoo",
  getMarketDataProvider: async () => mocks.provider,
}));

import { loadExpirations, loadPricedChain, NoOptionsError } from "@/lib/options/chain-server";
import { GET } from "@/app/api/options/chain/route";

let db: TestDb;
beforeEach(async () => {
  // A Monday, eighteen days before the expiry. Only the date is pinned; the
  // database driver's timers stay real.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-28T14:00:00Z"));
  db = await createTestDb();
  resetDbForTests(db);
  mocks.provider = broker();
  mocks.signedIn = true;
});
afterEach(async () => {
  await db.close();
  resetDbForTests(null);
  vi.useRealTimers();
});

describe("pricing the chain", () => {
  it("prices the strikes nearest the share price, the call and the put at each", async () => {
    const { contracts, priced } = await loadPricedChain(db, broker(), "XYZ", EXPIRY, SPOT, new Date(), {
      nearest: 3,
    });
    expect(contracts).toBe(CHAIN.length);
    expect([...new Set(priced.map((c) => c.strike))].sort((a, b) => a - b)).toEqual([95, 100, 105]);
    expect(priced.filter((c) => c.type === "call")).toHaveLength(3);
    expect(priced.filter((c) => c.type === "put")).toHaveLength(3);
  });

  it("keeps to the strike range somebody typed", async () => {
    const { priced } = await loadPricedChain(db, broker(), "XYZ", EXPIRY, SPOT, new Date(), {
      min: 120,
      max: 200,
    });
    expect([...new Set(priced.map((c) => c.strike))].sort((a, b) => a - b)).toEqual([120, 130, 140]);
  });

  it("reads the bid and ask from the broker's snapshot, and leaves a zero blank", async () => {
    const { priced } = await loadPricedChain(db, broker(), "XYZ", EXPIRY, SPOT, new Date(), { nearest: 1 });
    expect(priced[0]).toMatchObject({ bid: 2.4, ask: 2.6, last: 2.5, expiry: EXPIRY, multiplier: 100 });
    expect(priced[0].volume).toBeUndefined();
  });

  it("does not ask for expiries on a symbol the broker has no price for", async () => {
    const provider = broker();
    await expect(loadExpirations(db, provider, "DBS", new Date())).resolves.toEqual({
      spot: null,
      expirations: [],
    });
    expect(provider.expirationsAsked).toBe(0);
  });

  it("drops expiries that have passed and counts days from today, however old the cached list", async () => {
    await db.run(`INSERT INTO series_cache (key, payload, fetched_at) VALUES (?, ?, ?)`, [
      "options:expirations:XYZ",
      JSON.stringify([
        { date: "2026-09-25", days: 2 },
        { date: EXPIRY, days: 23 },
      ]),
      "2026-09-23T12:00:00.000Z",
    ]);
    const { expirations } = await loadExpirations(db, broker(), "XYZ", new Date("2026-09-28T14:00:00Z"));
    expect(expirations).toEqual([{ date: EXPIRY, days: 18 }]);
  });

  it("says plainly when the data source has no option chains", async () => {
    const plain: MarketDataProvider = {
      getQuotes: async () => [],
      getHistoricalPrices: async () => [],
    };
    await expect(loadExpirations(db, plain, "XYZ", new Date())).rejects.toBeInstanceOf(NoOptionsError);
  });
});

describe("GET /api/options/chain", () => {
  const get = (query: string) => GET(new Request(`http://localhost/api/options/chain?${query}`));

  it("needs to be told whose account it is working for", async () => {
    expect((await get("symbol=XYZ")).status).toBe(400);
  });

  it("answers with the price and the expiries, then with one expiry's chain", async () => {
    const first = await get("portfolio=carson&symbol=XYZ");
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ symbol: "XYZ", spot: SPOT, expirations: [{ date: EXPIRY, days: 18 }] });

    const second = await get(`portfolio=carson&symbol=XYZ&expiry=${EXPIRY}&strikes=4`);
    const body = await second.json();
    expect(second.status).toBe(200);
    expect(body.expiry).toBe(EXPIRY);
    expect(new Set(body.chain.map((c: { strike: number }) => c.strike)).size).toBe(4);
  });

  it("tells somebody who searched DBS that it cannot be found, not that something broke", async () => {
    const response = await get("portfolio=carson&symbol=DBS");
    expect(response.status).toBe(404);
    expect((await response.json()).error).toMatch(/Couldn't find DBS/);
  });

  it("refuses an expiry that is not listed", async () => {
    expect((await get("portfolio=carson&symbol=XYZ&expiry=2031-01-17")).status).toBe(400);
  });
});
