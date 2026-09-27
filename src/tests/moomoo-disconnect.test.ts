import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createTestDb, TEST_PORTFOLIO_ID, type TestDb } from "@/lib/db/testing";
import { resetDbForTests } from "@/lib/db";
import { generateKey } from "@/lib/crypto";
import { readConnection, saveConnection } from "@/lib/moomoo/tokens";
import type { AuthUser } from "@/lib/auth/session";

/**
 * "Disconnect wipes the token" is a promise the connection page makes. This
 * is what keeps it true: after Disconnect there is no stored key to use.
 */
const mocks = vi.hoisted(() => ({ user: null as AuthUser | null }));
vi.mock("@/lib/auth/guards", () => ({
  getCurrentUser: async () => mocks.user,
  requireUser: async () => mocks.user,
  unauthorized: () => Response.json({ error: "Authentication required" }, { status: 401 }),
  forbidden: () => Response.json({ error: "Not permitted" }, { status: 403 }),
}));

import { POST as disconnect } from "@/app/api/broker/moomoo/disconnect/route";

let db: TestDb;

beforeEach(async () => {
  process.env.TOKEN_ENCRYPTION_KEY = generateKey();
  db = await createTestDb();
  resetDbForTests(db);
  await db.run(
    "INSERT INTO users (id,username,display_name,password_hash,role,created_at) VALUES ('mia','mia','Mia','hash','viewer',?)",
    [new Date().toISOString()],
  );
  await db.run("UPDATE portfolios SET owner_user_id = 'mia' WHERE id = ?", [TEST_PORTFOLIO_ID]);
  mocks.user = { id: "mia", username: "mia", displayName: "Mia", role: "viewer", status: "active" };
  await saveConnection(db, TEST_PORTFOLIO_ID, {
    refreshToken: "refresh-secret",
    scope: "quote:read trade:read",
    accountId: null,
  });
});

afterEach(async () => {
  resetDbForTests(null);
  await db.close();
});

const press = () =>
  disconnect(
    new Request("http://localhost/api/broker/moomoo/disconnect?portfolio=carson", { method: "POST" }),
  );

it("removes the stored key, encrypted copy and all", async () => {
  expect(await readConnection(db, TEST_PORTFOLIO_ID)).not.toBeNull();
  expect((await press()).status).toBe(200);
  expect(await readConnection(db, TEST_PORTFOLIO_ID)).toBeNull();
  const rows = await db.all("SELECT * FROM broker_connections");
  expect(rows).toEqual([]);
});

it("is only the account owner's to press", async () => {
  mocks.user = { id: "leo", username: "leo", displayName: "Leo", role: "viewer", status: "active" };
  expect((await press()).status).not.toBe(200);
  expect(await readConnection(db, TEST_PORTFOLIO_ID)).not.toBeNull();
});
