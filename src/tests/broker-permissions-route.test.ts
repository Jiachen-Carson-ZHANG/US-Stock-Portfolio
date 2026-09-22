import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { createTestDb, TEST_PORTFOLIO_ID, type TestDb } from "@/lib/db/testing";
import { resetDbForTests } from "@/lib/db";
import { grantAccess } from "@/lib/portfolios";
import type { AuthUser } from "@/lib/auth/session";
const mocks = vi.hoisted(() => ({ user: null as AuthUser | null, sync: vi.fn(async () => 3) }));
vi.mock("@/lib/auth/guards", () => ({
  getCurrentUser: async () => mocks.user,
  requireUser: async () => mocks.user,
  unauthorized: () => Response.json({ error: "Authentication required" }, { status: 401 }),
  forbidden: () => Response.json({ error: "Not permitted" }, { status: 403 }),
}));
vi.mock("@/providers", () => ({ activeProvider: async () => "moomoo", getBrokerProvider: async () => ({}) }));
vi.mock("@/lib/portfolio/sync", () => ({ syncPositions: mocks.sync }));
import { POST as sync } from "@/app/api/portfolio/sync/route";
import { POST as disconnect } from "@/app/api/broker/moomoo/disconnect/route";
import { POST as connect } from "@/app/api/broker/moomoo/connect/route";
let db: TestDb;
beforeEach(async () => {
  db = await createTestDb(); resetDbForTests(db); mocks.sync.mockClear();
  for (const id of ["holder", "viewer"]) await db.run("INSERT INTO users (id,username,display_name,password_hash,role,created_at) VALUES (?,?,?,'hash','viewer',?)", [id,id,id,new Date().toISOString()]);
  await db.run("UPDATE portfolios SET owner_user_id = 'holder' WHERE id = ?", [TEST_PORTFOLIO_ID]);
  mocks.user = { id: "viewer", username: "viewer", displayName: "Viewer", role: "viewer" };
});
afterEach(async () => { resetDbForTests(null); await db.close(); });
const request = (path: string, origin = "http://localhost") => new Request(`http://localhost/api/${path}?portfolio=carson`, { method: "POST", headers: { origin } });
it("lets a permitted viewer refresh without letting them replace or disconnect the owner's broker", async () => {
  await grantAccess(db, TEST_PORTFOLIO_ID, "viewer");
  expect((await sync(request("portfolio/sync"))).status).toBe(200);
  expect(mocks.sync).toHaveBeenCalledTimes(1);
  expect((await connect(request("broker/moomoo/connect"))).status).toBe(403);
  expect((await disconnect(request("broker/moomoo/disconnect"))).status).toBe(403);
});
it("blocks a stranger, revoked viewer, signed-out caller and cross-origin requests", async () => {
  expect((await sync(request("portfolio/sync"))).status).toBe(403);
  await grantAccess(db, TEST_PORTFOLIO_ID, "viewer");
  expect((await sync(request("portfolio/sync", "https://untrusted.example"))).status).toBe(403);
  await db.run("DELETE FROM portfolio_access WHERE user_id = 'viewer'");
  expect((await sync(request("portfolio/sync"))).status).toBe(403);
  mocks.user = null;
  expect((await sync(request("portfolio/sync"))).status).toBe(401);
  expect(mocks.sync).not.toHaveBeenCalled();
});
