import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "@/lib/db/testing";
import { resetDbForTests } from "@/lib/db";
import { createPortfolio, findBySlug } from "@/lib/portfolios";
import { activityByMember, mostViewedAssets, recordActivity } from "@/lib/activity";
import type { AuthUser } from "@/lib/auth/session";

/**
 * Running the site does not open anybody's account. These pin the places where
 * the administrator used to reach past that: sharing an account that is not
 * his, the activity lists, and what removing somebody leaves behind.
 */
const mocks = vi.hoisted(() => ({ user: null as AuthUser | null }));

vi.mock("@/lib/auth/guards", async (original) => ({
  ...(await original<typeof import("@/lib/auth/guards")>()),
  getCurrentUser: async () => mocks.user,
  requireApiOwner: async () =>
    mocks.user?.role === "owner"
      ? { user: mocks.user }
      : { response: Response.json({ error: "Not permitted" }, { status: 403 }) },
}));

import { PATCH as share } from "@/app/api/portfolios/route";
import { DELETE as removeUser } from "@/app/api/admin/users/route";

let db: TestDb;
const NOW = new Date("2026-09-28T10:00:00Z");

async function addUser(username: string, role: "owner" | "viewer" = "viewer"): Promise<AuthUser> {
  const id = randomUUID();
  await db.run(
    `INSERT INTO users (id, username, display_name, password_hash, role, created_at)
     VALUES (?, ?, ?, 'hash', ?, ?)`,
    [id, username, username, role, NOW.toISOString()],
  );
  return { id, username, displayName: username, role, status: "active" };
}

const json = (method: string, body: unknown) =>
  new Request("http://localhost/api", {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(async () => {
  db = await createTestDb();
  resetDbForTests(db);
});

afterEach(async () => {
  resetDbForTests(null);
  await db.close();
});

describe("sharing", () => {
  it("will not let the administrator share somebody else's account, himself included", async () => {
    const admin = await addUser("carson", "owner");
    const mile = await addUser("mile");
    const hers = await createPortfolio(db, { slug: "mirat", displayName: "Mile", ownerUserId: mile.id, kind: "broker" });
    mocks.user = admin;

    const response = await share(json("PATCH", { portfolioId: hers.id, userId: admin.id, grant: true }));
    expect(response.status).toBe(403);
    const granted = await db.get(`SELECT 1 FROM portfolio_access WHERE portfolio_id = ? AND user_id = ?`, [hers.id, admin.id]);
    expect(granted).toBeFalsy();
  });

  it("still lets him share his own", async () => {
    const admin = await addUser("carson", "owner");
    const mile = await addUser("mile");
    const his = await createPortfolio(db, { slug: "carson-mock", displayName: "Carson", ownerUserId: admin.id, kind: "mock", openingCash: "1000" });
    mocks.user = admin;

    expect((await share(json("PATCH", { portfolioId: his.id, userId: mile.id, grant: true }))).status).toBe(200);
  });
});

describe("removing somebody", () => {
  it("takes their practice account and their activity with them", async () => {
    const admin = await addUser("carson", "owner");
    const zizhe = await addUser("zizhe");
    await createPortfolio(db, { slug: "zizhe-mock", displayName: "Zizhe", ownerUserId: zizhe.id, kind: "mock", openingCash: "1000" });
    await recordActivity(db, { userId: zizhe.id, username: "zizhe", kind: "login" });
    mocks.user = admin;

    expect((await removeUser(json("DELETE", { userId: zizhe.id }))).status).toBe(200);
    expect(await findBySlug(db, "zizhe-mock")).toBeNull();
    expect((await activityByMember(db)).map((m) => m.username)).not.toContain("zizhe");
  });

  it("lists only people who still have an account", async () => {
    await addUser("carson", "owner");
    await recordActivity(db, { userId: null, username: "father", kind: "login" });
    expect((await activityByMember(db)).map((m) => m.username)).not.toContain("father");
  });
});

describe("what was looked at", () => {
  it("counts only other people's views, and only inside your own accounts", async () => {
    await recordActivity(db, { userId: null, username: "mile", kind: "view_position", target: "NVDA", detail: "carson" });
    await recordActivity(db, { userId: null, username: "mile", kind: "view_position", target: "MU", detail: "mirat" });
    await recordActivity(db, { userId: null, username: "carson", kind: "view_position", target: "AAPL", detail: "carson" });

    const seen = await mostViewedAssets(db, { accounts: ["carson"], viewer: "carson" });
    expect(seen.map((row) => row.target)).toEqual(["NVDA"]);
  });
});
