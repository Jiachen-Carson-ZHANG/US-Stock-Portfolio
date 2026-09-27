import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "@/lib/db/testing";
import { resetDbForTests } from "@/lib/db";
import type { AuthUser } from "@/lib/auth/session";

/** A journal per person and share: yours alone, a page a day. */
const mocks = vi.hoisted(() => ({ user: null as AuthUser | null }));
vi.mock("@/lib/auth/guards", async (original) => ({
  ...(await original<typeof import("@/lib/auth/guards")>()),
  getCurrentUser: async () => mocks.user,
}));

import { GET, PUT } from "@/app/api/notes/route";

let db: TestDb;

async function addUser(username: string): Promise<AuthUser> {
  const id = randomUUID();
  await db.run(
    `INSERT INTO users (id, username, display_name, password_hash, role, created_at) VALUES (?, ?, ?, 'hash', 'viewer', ?)`,
    [id, username, username, new Date().toISOString()],
  );
  return { id, username, displayName: username, role: "viewer", status: "active" };
}

const put = (body: unknown) =>
  PUT(new Request("http://localhost/api/notes", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));
const get = async (symbol: string) =>
  (await (await GET(new Request(`http://localhost/api/notes?symbol=${symbol}`))).json()).notes as { date: string; body: string }[];

beforeEach(async () => {
  db = await createTestDb();
  resetDbForTests(db);
});
afterEach(async () => {
  resetDbForTests(null);
  await db.close();
});

it("keeps each day's page, newest first, and only for its author", async () => {
  const mia = await addUser("mia");
  const leo = await addUser("leo");

  mocks.user = mia;
  await put({ symbol: "AAPL", date: "2026-09-25", body: "Bought the dip." });
  await put({ symbol: "AAPL", date: "2026-09-28", body: "Waiting for earnings." });
  expect((await get("AAPL")).map((note) => note.date)).toEqual(["2026-09-28", "2026-09-25"]);

  mocks.user = leo;
  expect(await get("AAPL")).toEqual([]);
});

it("forgets a page that was emptied", async () => {
  mocks.user = await addUser("mia");
  await put({ symbol: "NVDA", date: "2026-09-28", body: "Something." });
  await put({ symbol: "NVDA", date: "2026-09-28", body: "   " });
  expect(await get("NVDA")).toEqual([]);
});

it("asks who you are before anything", async () => {
  mocks.user = null;
  expect((await GET(new Request("http://localhost/api/notes?symbol=AAPL"))).status).toBe(401);
});
