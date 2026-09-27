import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, TEST_PORTFOLIO_ID, type TestDb } from "@/lib/db/testing";
import { resetDbForTests } from "@/lib/db";
import type { AuthUser } from "@/lib/auth/session";

/**
 * The rule that matters most about a broker connection: whatever somebody
 * ticks on moomoo's screen, this site keeps a key only when it can read and
 * nothing else. The checklist and the confirmation box are reminders; this
 * is the enforcement, and these tests are what keep it enforced.
 */
const mocks = vi.hoisted(() => ({
  user: null as AuthUser | null,
  scope: "quote:read trade:read",
  saved: [] as { portfolioId: string; scope: string }[],
}));

vi.mock("@/lib/auth/guards", () => ({
  getCurrentUser: async () => mocks.user,
}));
vi.mock("@/lib/moomoo/flow", () => ({
  consumePendingFlow: async () => ({
    state: "state-1",
    verifier: "verifier",
    portfolioId: "00000000-0000-4000-8000-000000000001",
  }),
  redirectUri: () => "http://localhost/api/broker/moomoo/callback",
}));
vi.mock("@/lib/moomoo/oauth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/moomoo/oauth")>("@/lib/moomoo/oauth");
  return {
    ...actual,
    exchangeCode: async () => ({
      access_token: "access",
      token_type: "Bearer",
      expires_in: 7200,
      refresh_token: "refresh",
      scope: mocks.scope,
    }),
  };
});
vi.mock("@/lib/moomoo/tokens", () => ({
  saveConnection: async (_db: unknown, portfolioId: string, params: { scope: string }) => {
    mocks.saved.push({ portfolioId, scope: params.scope });
  },
}));
vi.mock("@/lib/portfolio/sync", () => ({
  storedBrokers: async () => ["moomoo"],
  syncPositions: async () => 0,
}));

import { GET as callback } from "@/app/api/broker/moomoo/callback/route";

let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
  resetDbForTests(db);
  mocks.saved = [];
  await db.run(
    "INSERT INTO users (id,username,display_name,password_hash,role,created_at) VALUES ('mia','mia','Mia','hash','viewer',?)",
    [new Date().toISOString()],
  );
  await db.run("UPDATE portfolios SET owner_user_id = 'mia' WHERE id = ?", [TEST_PORTFOLIO_ID]);
  mocks.user = { id: "mia", username: "mia", displayName: "Mia", role: "viewer", status: "active" };
});

afterEach(async () => {
  resetDbForTests(null);
  await db.close();
});

const returnFrom = async (scope: string) => {
  mocks.scope = scope;
  const response = await callback(
    new Request("http://localhost/api/broker/moomoo/callback?code=abc&state=state-1"),
  );
  return new URL(response.headers.get("location") ?? "").searchParams.get("moomoo");
};

describe("what comes back from moomoo's consent screen", () => {
  it("keeps a grant of exactly the two read permissions", async () => {
    expect(await returnFrom("quote:read trade:read accid:123")).toBe("connected");
    expect(mocks.saved).toEqual([
      { portfolioId: TEST_PORTFOLIO_ID, scope: "quote:read trade:read accid:123" },
    ]);
  });

  it("refuses a grant that can trade, and stores nothing", async () => {
    expect(await returnFrom("quote:read trade:read trade:write")).toBe("write_scope");
    expect(mocks.saved).toEqual([]);
  });

  it("refuses a grant that can edit watchlists, and stores nothing", async () => {
    expect(await returnFrom("quote:read quote:write trade:read")).toBe("write_scope");
    expect(mocks.saved).toEqual([]);
  });

  it("refuses anything unrecognised alongside the two, and stores nothing", async () => {
    expect(await returnFrom("quote:read trade:read admin")).toBe("write_scope");
    expect(mocks.saved).toEqual([]);
  });

  it("says so plainly when too little was ticked, and stores nothing", async () => {
    expect(await returnFrom("quote:read")).toBe("missing_scope");
    expect(await returnFrom("trade:read")).toBe("missing_scope");
    expect(mocks.saved).toEqual([]);
  });

  it("will not attach a key to somebody else's account", async () => {
    mocks.user = { id: "someone", username: "someone", displayName: "Someone", role: "viewer", status: "active" };
    expect(await returnFrom("quote:read trade:read")).toBe("state_mismatch");
    expect(mocks.saved).toEqual([]);
  });
});
