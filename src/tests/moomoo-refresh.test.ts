import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createTestDb, TEST_PORTFOLIO_ID, type TestDb } from "@/lib/db/testing";
import { resetDbForTests } from "@/lib/db";
import { generateKey } from "@/lib/crypto";
import { readConnection, readConnectionStatus, saveConnection } from "@/lib/moomoo/tokens";
import { clearTokenCache, MoomooAuthExpiredError, MoomooUnavailableError, moomooGet } from "@/lib/moomoo/client";
import { notificationsFor } from "@/lib/notifications";

/**
 * From 5 October moomoo answered every refresh with 400 invalid_grant, "sig
 * is invalid". The site asked again up to ten times a second for two days,
 * logged only "returned 400", and told nobody. These pin what happens now.
 */
let db: TestDb;
let tokenCalls = 0;
let tokenReply: () => Response;

const PATH = "/api/v1.0/accounts/authorized_trd_accs";

beforeEach(async () => {
  process.env.TOKEN_ENCRYPTION_KEY = generateKey();
  process.env.MOOMOO_CLIENT_ID = "client";
  db = await createTestDb();
  resetDbForTests(db);
  clearTokenCache();
  await db.run(
    "INSERT INTO users (id,username,display_name,password_hash,role,created_at) VALUES ('mia','mia','Mia','hash','viewer',?)",
    [new Date().toISOString()],
  );
  await db.run("UPDATE portfolios SET owner_user_id = 'mia' WHERE id = ?", [TEST_PORTFOLIO_ID]);
  await saveConnection(db, TEST_PORTFOLIO_ID, { refreshToken: "refresh-1", scope: "quote:read trade:read", accountId: null });
  tokenCalls = 0;
  tokenReply = () => Response.json({ error: "invalid_grant", error_description: "sig is invalid" }, { status: 400 });
  vi.stubGlobal("fetch", async (url: string) => {
    if (String(url).endsWith("/oauth2/token")) {
      tokenCalls += 1;
      return tokenReply();
    }
    return Response.json({ s: "ok", d: { acc_list: [] } });
  });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  resetDbForTests(null);
  await db.close();
});

it("records moomoo's reason when it refuses, and tells the owner once", async () => {
  await expect(moomooGet(TEST_PORTFOLIO_ID, PATH)).rejects.toBeInstanceOf(MoomooAuthExpiredError);
  const status = await readConnectionStatus(db, TEST_PORTFOLIO_ID);
  expect(status?.status).toBe("expired");
  expect(status?.lastError).toMatch(/invalid_grant: sig is invalid/);

  const told = await notificationsFor(db, "mia");
  expect(told.filter((n) => n.kind === "broker_expired")).toHaveLength(1);
});

it("does not ask moomoo again every few seconds once it has said no", async () => {
  await expect(moomooGet(TEST_PORTFOLIO_ID, PATH)).rejects.toBeInstanceOf(MoomooAuthExpiredError);
  for (let i = 0; i < 5; i += 1) {
    await expect(moomooGet(TEST_PORTFOLIO_ID, PATH)).rejects.toBeInstanceOf(MoomooAuthExpiredError);
  }
  expect(tokenCalls).toBe(1);
  expect((await notificationsFor(db, "mia")).filter((n) => n.kind === "broker_expired")).toHaveLength(1);
});

it("treats moomoo not answering as an outage, not as a reason to reconnect", async () => {
  tokenReply = () => new Response("busy", { status: 503 });
  await expect(moomooGet(TEST_PORTFOLIO_ID, PATH)).rejects.toBeInstanceOf(MoomooUnavailableError);
  expect((await readConnectionStatus(db, TEST_PORTFOLIO_ID))?.status).toBe("error");
  expect(await notificationsFor(db, "mia")).toHaveLength(0);
});

it("works again the moment the person reconnects", async () => {
  await expect(moomooGet(TEST_PORTFOLIO_ID, PATH)).rejects.toBeInstanceOf(MoomooAuthExpiredError);
  await saveConnection(db, TEST_PORTFOLIO_ID, { refreshToken: "refresh-2", scope: "quote:read trade:read", accountId: null });
  tokenReply = () => Response.json({ access_token: "a", token_type: "Bearer", expires_in: 7200, scope: "quote:read trade:read" });
  await expect(moomooGet(TEST_PORTFOLIO_ID, PATH)).resolves.toBeDefined();
  const status = await readConnectionStatus(db, TEST_PORTFOLIO_ID);
  expect(status).toMatchObject({ status: "connected", lastError: null });
});

it("keeps a new refresh token if moomoo ever sends one", async () => {
  tokenReply = () =>
    Response.json({ access_token: "a", token_type: "Bearer", expires_in: 7200, refresh_token: "refresh-rotated", scope: "quote:read trade:read" });
  await moomooGet(TEST_PORTFOLIO_ID, PATH);
  expect((await readConnection(db, TEST_PORTFOLIO_ID))?.refreshToken).toBe("refresh-rotated");
});
