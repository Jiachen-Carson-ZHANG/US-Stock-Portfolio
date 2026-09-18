import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resetDbForTests } from "@/lib/db";
import { createTestDb, type TestDb } from "@/lib/db/testing";
const mocks = vi.hoisted(() => ({
  user: null as null | {
    id: string;
    username: string;
    displayName: string;
    role: "owner" | "viewer";
  },
  provider: "mock",
  quotes: vi.fn(),
}));
vi.mock("@/lib/auth/guards", () => ({
  authenticateRequest: async () => mocks.user,
  unauthorized: () =>
    Response.json({ error: "Authentication required" }, { status: 401 }),
}));
vi.mock("@/providers", () => ({
  activeProvider: () => mocks.provider,
  getMarketDataProvider: () => ({ getQuotes: mocks.quotes }),
}));
import { GET, POST } from "@/app/api/family/route";
const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/family", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
  resetDbForTests(db);
  mocks.user = {
    id: "owner",
    username: "owner",
    displayName: "Owner",
    role: "owner",
  };
  mocks.provider = "mock";
  mocks.quotes.mockReset();
});

afterEach(async () => {
  await db.close();
  resetDbForTests(null);
});
it("requires authentication for reads and writes", async () => {
  mocks.user = null;
  expect((await GET()).status).toBe(401);
  expect((await post({ action: "read" })).status).toBe(401);
});
it("uses authenticated authors and strips impersonation fields", async () => {
  const r = await post({
    action: "post",
    text: "Hello",
    userId: "attacker",
    author: "Not owner",
  });
  const data = await r.json();
  expect(data.posts[0].userId).toBe("owner");
  expect(data.posts[0].author).toBe("Owner");
});
it("prices demo trades on the server and separates live price provenance", async () => {
  const endsAt = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  await post({ action: "challenge", text: "Demo", endsAt });
  await post({ action: "join" });
  mocks.quotes.mockResolvedValue([
    {
      symbol: "AAPL",
      price: 100,
      source: "mock",
      dataTimestamp: new Date().toISOString(),
    },
  ]);
  const r = await post({
    action: "trade",
    symbol: "AAPL",
    side: "buy",
    quantity: 2,
    price: 0.01,
  });
  const state = await r.json();
  expect(state.challenge.mode).toBe("demo");
  expect(state.challenge.members[0].cash).toBe(9800);
  mocks.provider = "moomoo";
  expect(
    (await post({ action: "trade", symbol: "AAPL", side: "buy", quantity: 1 }))
      .status,
  ).toBe(409);
});
it("does not expose sealed prediction text over GET or write responses", async () => {
  const revealAt = new Date(Date.now() + 7 * 86400000)
    .toISOString()
    .slice(0, 10);
  expect(
    await (
      await post({ action: "predict", text: "PRIVATE FORECAST", revealAt })
    ).text(),
  ).not.toContain("PRIVATE FORECAST");
  expect(await (await GET()).text()).not.toContain("PRIVATE FORECAST");
});
it("rejects owner actions from a viewer and malformed input", async () => {
  mocks.user!.role = "viewer";
  expect(
    (await post({ action: "challenge", text: "Try", endsAt: "2099-01-01" }))
      .status,
  ).toBe(400);
  expect((await post({ action: "post", text: "" })).status).toBe(400);
});
