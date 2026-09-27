import { beforeEach, expect, it, vi } from "vitest";

/**
 * Symbols to moomoo codes and back. A ticker with a dot in it is a US ticker
 * (BRK.B), not a market prefix; a code with a real market prefix keeps it.
 */
const mocks = vi.hoisted(() => ({ asked: [] as string[] }));

vi.mock("@/lib/moomoo/client", () => ({
  UnknownSymbolsError: class extends Error {},
  moomooGet: vi.fn(),
  moomooPost: async (_portfolio: string, _path: string, body: { code_list: string[] }) => {
    mocks.asked.push(...body.code_list);
    return {
      snapshot_list: body.code_list.map((code) => ({
        code,
        name: code,
        last_price: 10,
        prev_close_price: 9,
        update_time: "2026-09-25 16:00:00",
      })),
    };
  },
}));

import { MoomooMarketDataProvider } from "@/providers/market-data/moomoo";

beforeEach(() => {
  mocks.asked = [];
});

it("sends a dotted US ticker with the US prefix, and hands it back as asked", async () => {
  const quotes = await new MoomooMarketDataProvider("pf").getQuotes(["BRK.B", "AAPL"]);
  expect(mocks.asked).toEqual(["US.BRK.B", "US.AAPL"]);
  expect(quotes.map((quote) => quote.symbol)).toEqual(["BRK.B", "AAPL"]);
});

it("keeps another market's prefix both ways", async () => {
  const quotes = await new MoomooMarketDataProvider("pf").getQuotes(["HK.00700"]);
  expect(mocks.asked).toEqual(["HK.00700"]);
  expect(quotes[0].symbol).toBe("HK.00700");
});
