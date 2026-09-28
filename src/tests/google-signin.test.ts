import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createTestDb, type TestDb } from "@/lib/db/testing";
import { resetDbForTests } from "@/lib/db";
import { generateKey } from "@/lib/crypto";
import type { AuthUser } from "@/lib/auth/session";

/**
 * Signing in with Google: by the account's permanent id, only once linked,
 * and never matched to somebody's account by an email address.
 */
const mocks = vi.hoisted(() => ({
  user: null as AuthUser | null,
  jar: new Map<string, string>(),
  profile: { sub: "g-1", email: "mia@gmail.com", email_verified: true, name: "Mia" } as Record<string, unknown>,
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (mocks.jar.has(name) ? { value: mocks.jar.get(name) } : undefined),
    set: (name: string, value: string) => void mocks.jar.set(name, value),
    delete: (name: string) => void mocks.jar.delete(name),
  }),
}));
vi.mock("@/lib/auth/guards", async (original) => ({
  ...(await original<typeof import("@/lib/auth/guards")>()),
  getCurrentUser: async () => mocks.user,
}));

import { GET as start } from "@/app/api/auth/google/start/route";
import { GET as callback } from "@/app/api/auth/google/callback/route";

let db: TestDb;

async function addUser(username: string, email: string | null = null): Promise<AuthUser> {
  const id = randomUUID();
  await db.run(
    `INSERT INTO users (id, username, display_name, password_hash, role, created_at, email) VALUES (?, ?, ?, 'hash', 'viewer', ?, ?)`,
    [id, username, username, new Date().toISOString(), email],
  );
  return { id, username, displayName: username, role: "viewer", status: "active" };
}

/** Starts at the site, "comes back" from Google with the state it was given. */
async function roundTrip(intent: "signin" | "link", state?: string) {
  const out = await start(new Request(`http://localhost/api/auth/google/start${intent === "link" ? "?intent=link" : ""}`));
  const given = new URL(out.headers.get("location") ?? "").searchParams.get("state");
  const response = await callback(new Request(`http://localhost/api/auth/google/callback?code=abc&state=${state ?? given}`));
  return new URL(response.headers.get("location") ?? "").pathname + new URL(response.headers.get("location") ?? "").search;
}

beforeEach(async () => {
  db = await createTestDb();
  resetDbForTests(db);
  process.env.TOKEN_ENCRYPTION_KEY = generateKey();
  process.env.GOOGLE_CLIENT_ID = "client";
  process.env.GOOGLE_CLIENT_SECRET = "secret";
  mocks.user = null;
  mocks.jar.clear();
  mocks.profile = { sub: "g-1", email: "mia@gmail.com", email_verified: true, name: "Mia" };
  vi.stubGlobal("fetch", async (url: string) =>
    String(url).includes("token")
      ? Response.json({ access_token: "at" })
      : Response.json(mocks.profile),
  );
});

afterEach(async () => {
  vi.unstubAllGlobals();
  delete process.env.GOOGLE_CLIENT_ID;
  delete process.env.GOOGLE_CLIENT_SECRET;
  resetDbForTests(null);
  await db.close();
});

it("refuses a return trip whose state this browser was not given", async () => {
  expect(await roundTrip("signin", "forged")).toBe("/login?google=failed");
});

it("signs in only after the account's owner has linked it", async () => {
  const mia = await addUser("mia");
  mocks.user = mia;
  expect(await roundTrip("link")).toBe("/account?google=linked");

  mocks.user = null;
  mocks.jar.clear();
  expect(await roundTrip("signin")).toBe("/");
  const session = await db.get<{ user_id: string }>(`SELECT user_id FROM sessions ORDER BY created_at DESC LIMIT 1`);
  expect(session?.user_id).toBe(mia.id);
});

it("never matches an existing account by its email address", async () => {
  // Somebody typed this Gmail address at sign-up. Whoever owns the address
  // must not be let into their account by signing in with Google.
  const other = await addUser("leo", "mia@gmail.com");
  expect(await roundTrip("signin")).toBe("/");
  const session = await db.get<{ user_id: string }>(`SELECT user_id FROM sessions ORDER BY created_at DESC LIMIT 1`);
  expect(session?.user_id).not.toBe(other.id);
  const created = await db.get<{ status: string; username: string }>(`SELECT status, username FROM users WHERE id = ?`, [session?.user_id]);
  expect(created).toMatchObject({ status: "pending", username: "mia" });
});

it("will not link a Google account that already belongs to someone else", async () => {
  const mia = await addUser("mia");
  mocks.user = mia;
  await roundTrip("link");
  mocks.user = await addUser("leo");
  mocks.jar.clear();
  expect(await roundTrip("link")).toBe("/account?google=taken");
});
