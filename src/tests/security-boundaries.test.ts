import { afterEach, describe, expect, it, vi } from "vitest";
import { assertReadOnlyScope } from "@/lib/moomoo/oauth";
import { isOpenAccess } from "@/lib/auth/mode";
import { clearTokenCache, moomooGet, moomooRequest } from "@/lib/moomoo/client";

const mocks = vi.hoisted(() => ({ scope: "quote:read trade:read", db: { run: vi.fn() } }));
vi.mock("@/lib/db", () => ({ getDb: async () => mocks.db }));
vi.mock("@/lib/moomoo/tokens", () => ({
  readConnection: async () => ({ refreshToken: "synthetic-refresh", scope: mocks.scope }),
  markRefreshed: vi.fn(), markStatus: vi.fn(),
}));
afterEach(() => { clearTokenCache(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); mocks.scope = "quote:read trade:read"; });

describe("read-only broker boundary", () => {
  it.each([undefined, null, "", "trade:read", "quote:read trade:read trade:write", "quote:read trade:read quote:write", "quote:read trade:read admin", "quote:read trade:read accid:garbage"])("rejects unsafe scope %s", (scope) => {
    expect(() => assertReadOnlyScope(scope)).toThrow();
  });
  it.each(["quote:read trade:read", "quote:read trade:read accid:123", "trade:read quote:read accid:*"])("accepts documented reads %s", (scope) => {
    expect(() => assertReadOnlyScope(scope)).not.toThrow();
  });
  it("blocks an order request before retrieving or sending a token", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(moomooRequest("pf", "/api/v1.0/accounts/123/orders", { method: "POST" })).rejects.toThrow("allowlist");
    expect(fetch).not.toHaveBeenCalled();
  });
  it("blocks legacy unsafe stored grants before attempting refresh", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    mocks.scope = "quote:read trade:read trade:write";
    await expect(moomooGet("pf", "/api/v1.0/accounts/123/positions")).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([undefined, "", "quote:read trade:read trade:write", "quote:read trade:read new:permission"])("never sends refreshed unsafe token upstream: %s", async (scope) => {
    vi.stubEnv("MOOMOO_CLIENT_ID", "test-client");
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: "unsafe", expires_in: 7200, scope })));
    vi.stubGlobal("fetch", fetch);
    await expect(moomooGet("pf", "/api/v1.0/accounts/123/positions")).rejects.toThrow();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toContain("/oauth2/token");
  });
  it("refreshes and uses only a validated read token", async () => {
    vi.stubEnv("MOOMOO_CLIENT_ID", "test-client");
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: "safe", expires_in: 7200, scope: "quote:read trade:read accid:123" })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ s: "ok", d: [] })));
    vi.stubGlobal("fetch", fetch);
    expect(await moomooGet("pf", "/api/v1.0/accounts/123/positions")).toEqual([]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1][1].headers.Authorization).toBe("Bearer safe");
  });
});

describe("production authentication", () => {
  it.each([undefined, "", "open", "pasword"])("refuses production mode %s", (mode) => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("AUTH_MODE", mode);
    expect(() => isOpenAccess()).toThrow();
  });
  it("requires passwords in production", () => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("AUTH_MODE", "password");
    expect(isOpenAccess()).toBe(false);
  });
});
