import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";
import { MOOMOO_API_BASE, refreshAccessToken } from "./oauth";
import { markRefreshed, markStatus, readConnection } from "./tokens";

type Envelope<T> = { s: "ok"; d: T } | { s: "error"; errcode: number; errmsg: string };

/** Access tokens live ~2h; caching avoids a refresh round trip per request. */
let cachedAccessToken: { token: string; expiresAt: number } | null = null;

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

export function clearTokenCache(): void {
  cachedAccessToken = null;
}

function clientId(): string {
  const id = process.env.MOOMOO_CLIENT_ID;
  if (!id) throw new Error("MOOMOO_CLIENT_ID is not set.");
  return id;
}

async function accessToken(): Promise<string> {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) {
    return cachedAccessToken.token;
  }

  const db = getDb();
  const connection = readConnection(db);
  if (!connection) throw new MoomooNotConnectedError();

  try {
    const tokens = await refreshAccessToken({
      refreshToken: connection.refreshToken,
      clientId: clientId(),
    });

    cachedAccessToken = {
      token: tokens.access_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
    };
    markRefreshed(db);
    logger.info("broker.token.refreshed", { provider: "moomoo" });
    return tokens.access_token;
  } catch (error) {
    markStatus(db, "expired");
    clearTokenCache();
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
export async function moomooRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  let response = await call(path, init, await accessToken());

  if (response.status === 401) {
    clearTokenCache();
    response = await call(path, init, await accessToken());
  }

  if (response.status === 429) {
    const wait = Number(response.headers.get("Retry-After") ?? 2);
    await new Promise((resolve) => setTimeout(resolve, Math.min(wait, 10) * 1000));
    response = await call(path, init, await accessToken());
  }

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`moomoo ${path} returned HTTP ${response.status}`);
  }

  const body = JSON.parse(text) as Envelope<T>;
  if (body.s !== "ok") {
    throw new Error(`moomoo ${path} error ${body.errcode}: ${body.errmsg}`);
  }

  return body.d;
}

export function moomooGet<T>(path: string): Promise<T> {
  return moomooRequest<T>(path, { method: "GET" });
}

export function moomooPost<T>(path: string, body: unknown): Promise<T> {
  return moomooRequest<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}
