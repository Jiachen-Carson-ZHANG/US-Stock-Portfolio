import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "@/lib/db/testing";
import { resetDbForTests } from "@/lib/db";
import { canRead, createPortfolio, ensureOwnBrokerPortfolio, visibleTo } from "@/lib/portfolios";
import type { AuthUser } from "@/lib/auth/session";

/**
 * Signing up made a practice account and nothing else, and a practice
 * account cannot hold a broker connection — so nobody but the site owner had
 * anywhere to connect moomoo, or any way to make somewhere.
 */
const mocks = vi.hoisted(() => ({ user: null as AuthUser | null }));
vi.mock("@/lib/auth/guards", () => ({
  getCurrentUser: async () => mocks.user,
  unauthorized: () => Response.json({ error: "Authentication required" }, { status: 401 }),
}));

import { POST } from "@/app/api/me/brokerage/route";

let db: TestDb;
const mia: AuthUser = { id: "mia", username: "mia", displayName: "Mia", role: "viewer", status: "active" };
const leo: AuthUser = { id: "leo", username: "leo", displayName: "Leo", role: "viewer", status: "active" };

beforeEach(async () => {
  db = await createTestDb();
  resetDbForTests(db);
  for (const user of [mia, leo]) {
    await db.run(
      "INSERT INTO users (id,username,display_name,password_hash,role,created_at) VALUES (?,?,?,'hash','viewer',?)",
      [user.id, user.username, user.displayName, new Date().toISOString()],
    );
  }
  mocks.user = mia;
});

afterEach(async () => {
  resetDbForTests(null);
  await db.close();
});

describe("your own real account", () => {
  it("is made once, as a broker account you own", async () => {
    const first = await ensureOwnBrokerPortfolio(db, mia);
    expect(first.created).toBe(true);
    expect(first.portfolio).toMatchObject({ slug: "mia-moomoo", kind: "broker", ownerUserId: "mia" });

    const again = await ensureOwnBrokerPortfolio(db, mia);
    expect(again.created).toBe(false);
    expect(again.portfolio.id).toBe(first.portfolio.id);
  });

  it("finds a free address if the obvious one is taken", async () => {
    await createPortfolio(db, { slug: "mia-moomoo", displayName: "Other", ownerUserId: "leo", kind: "mock" });
    const { portfolio } = await ensureOwnBrokerPortfolio(db, mia);
    expect(portfolio.slug).toBe("mia-moomoo-2");
  });

  it("is private to its owner", async () => {
    const { portfolio } = await ensureOwnBrokerPortfolio(db, mia);
    expect(await canRead(db, mia, portfolio.id)).toBe(true);
    expect(await canRead(db, leo, portfolio.id)).toBe(false);
    expect((await visibleTo(db, leo)).map((p) => p.slug)).not.toContain("mia-moomoo");
  });
});

describe("asking for it", () => {
  const ask = () => POST(new Request("http://localhost/api/me/brokerage", { method: "POST" }));

  it("makes it for the person asking, and hands back where to connect", async () => {
    const response = await ask();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ slug: "mia-moomoo", created: true });
    expect((await (await ask()).json()).created).toBe(false);
  });

  it("needs a signed-in, approved person", async () => {
    mocks.user = null;
    expect((await ask()).status).toBe(401);
  });

  it("refuses a request from another site", async () => {
    const response = await POST(
      new Request("http://localhost/api/me/brokerage", {
        method: "POST",
        headers: { origin: "https://untrusted.example" },
      }),
    );
    expect(response.status).toBe(403);
  });
});
