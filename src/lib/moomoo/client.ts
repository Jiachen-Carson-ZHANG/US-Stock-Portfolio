import { getDb } from "@/lib/db";
import { dedupe } from "@/lib/inflight";
import { logger } from "@/lib/logger";
import { MOOMOO_API_BASE, refreshAccessToken, assertReadOnlyScope } from "./oauth";
import { markRefreshed, markStatus, readConnection } from "./tokens";

/** Trading endpoints answer with {s,d}; quote endpoints with {ret_code,data}. */
type Envelope<T> =
  | { s: "ok"; d: T }
  | { s: "error"; errcode: number; errmsg: string }
  | { ret_code: number; ret_msg: string; data: T };

/**
 * moomoo account IDs are uint64 and exceed Number.MAX_SAFE_INTEGER, so parsing
 * them as JSON numbers silently rounds off the last digits and produces a valid
 * looking ID for an account that does not exist. Quoting any integer of 16+
 * digits before parsing keeps them exact as strings.
 */
export function parseJsonPreservingBigInts(text: string): unknown {
  return JSON.parse(text.replace(/:\s*(-?\d{16,})(?=\s*[,}\]])/g, ':"$1"'));
}

/**
 * Access tokens live ~2h; caching avoids a refresh round trip per request.
 *
 * Keyed by portfolio. A single cached token was fine while one account
 * existed, and becomes a leak the moment a second one does: whoever refreshed
 * last would lend their credential to everybody else's requests.
 */
const cachedAccessTokens = new Map<string, { token: string; expiresAt: number }>();

export class MoomooNotConnectedError extends Error {
  constructor() {
    super("Moomoo account is not connected.");
    this.name = "MoomooNotConnectedError";
  }
}

export class MoomooAuthExpiredError extends Error {
  constructor() {
    super("Moomoo authorization expired. Reconnect the account.");
    this.name = "MoomooAuthExpiredError";
  }
}

export function clearTokenCache(portfolioId?: string): void {
  if (portfolioId === undefined) cachedAccessTokens.clear();
  else cachedAccessTokens.delete(portfolioId);
}

function clientId(): string {
  const id = process.env.MOOMOO_CLIENT_ID;
  if (!id) throw new Error("MOOMOO_CLIENT_ID is not set.");
  return id;
}

async function accessToken(portfolioId: string): Promise<string> {
  const cached = cachedAccessTokens.get(portfolioId);
  if (cached && cached.expiresAt > Date.now() + 60_000) {
    return cached.token;
  }

  const db = await getDb();
  const connection = await readConnection(db, portfolioId);
  if (!connection) throw new MoomooNotConnectedError();

  try {
    assertReadOnlyScope(connection.scope);
    // Deduplicated: two requests arriving milliseconds apart were each doing
    // their own round trip to moomoo for the same token, which is pure
    // latency for whoever arrived second.
    const tokens = await dedupe(`moomoo:token:${portfolioId}`, () =>
      refreshAccessToken({
        refreshToken: connection.refreshToken,
        clientId: clientId(),
      }),
    );

    assertReadOnlyScope(tokens.scope);
    cachedAccessTokens.set(portfolioId, {
      token: tokens.access_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
    });
    await markRefreshed(db, portfolioId);
    logger.info("broker.token.refreshed", { provider: "moomoo" });
    return tokens.access_token;
  } catch (error) {
    await markStatus(db, portfolioId, "expired");
    clearTokenCache(portfolioId);
    logger.error("broker.token.refresh_failed", {
      provider: "moomoo",
      reason: error instanceof Error ? error.message : "unknown",
    });
    throw new MoomooAuthExpiredError();
  }
}

async function call(path: string, init: RequestInit, token: string) {
  return fetch(`${MOOMOO_API_BASE}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      Authorization: `Bearer ${token}`,
    },
    cache: "no-store",
  });
}

/**
 * Calls a moomoo REST endpoint and unwraps its `{s, d}` envelope. Retries once
 * on 401 with a fresh token and once on 429 after the advertised delay.
 */
export function assertReadOnlyRequest(path: string, method = "GET"): void {
  const pathname = path.split("?")[0];
  const allowed = method === "GET" && (
    pathname === "/api/v1.0/accounts/authorized_trd_accs" ||
    /^\/api\/v1\.0\/accounts\/[0-9]+\/(positions|funds|fills_history)$/.test(pathname) ||
    /^\/api\/v1\.0\/quote\/[^/]+\/history-kline$/.test(pathname)
  ) || method === "POST" && pathname === "/api/v1.0/quote/snapshot";
  if (!allowed) throw new Error("Broker operation is not on the read-only allowlist.");
}

export async function moomooRequest<T>(
  portfolioId: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  assertReadOnlyRequest(path, init.method ?? "GET");
  let response = await call(path, init, await accessToken(portfolioId));

  if (response.status === 401) {
    clearTokenCache(portfolioId);
    response = await call(path, init, await accessToken(portfolioId));
  }

  if (response.status === 429) {
    const wait = Number(response.headers.get("Retry-After") ?? 2);
    await new Promise((resolve) => setTimeout(resolve, Math.min(wait, 10) * 1000));
    response = await call(path, init, await accessToken(portfolioId));
  }

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`moomoo ${path} returned HTTP ${response.status}`);
  }

  const body = parseJsonPreservingBigInts(text) as Envelope<T>;

  if ("s" in body) {
    if (body.s !== "ok") {
      throw new Error(`moomoo ${path} error ${body.errcode}: ${body.errmsg}`);
    }
    return body.d;
  }

  if (body.ret_code !== 0) {
    throw new Error(`moomoo ${path} error ${body.ret_code}: ${body.ret_msg}`);
  }
  return body.data;
}

export function moomooGet<T>(portfolioId: string, path: string): Promise<T> {
  return moomooRequest<T>(portfolioId, path, { method: "GET" });
}

export function moomooPost<T>(
  portfolioId: string,
  path: string,
  body: unknown,
): Promise<T> {
  return moomooRequest<T>(portfolioId, path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
