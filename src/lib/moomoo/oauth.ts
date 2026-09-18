import { createHash, randomBytes } from "node:crypto";

export const MOOMOO_API_BASE = "https://webapi.moomoo.com";

/**
 * Read-only access is all this application is permitted to hold (§10). moomoo's
 * consent screen lets the user pick scopes, so the grant is verified after the
 * exchange rather than trusted from the request.
 */
export const FORBIDDEN_SCOPES = ["trade:write", "quote:write"] as const;

export type TokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
};

export type PkcePair = {
  verifier: string;
  challenge: string;
};

export function createPkcePair(): PkcePair {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function createState(): string {
  return randomBytes(16).toString("base64url");
}

/** A grant is acceptable only when it carries no write capability at all. */
export function writeScopesIn(scope: string): string[] {
  const granted = scope.split(/\s+/).filter(Boolean);
  return granted.filter((s) =>
    (FORBIDDEN_SCOPES as readonly string[]).includes(s),
  );
}

export function authorizeUrl(params: {
  clientId: string;
  challenge: string;
  redirectUri: string;
  state: string;
}): string {
  const url = new URL("/oauth2/authorize/confirm", MOOMOO_API_BASE);
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("code_challenge", params.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", params.state);
  // Not documented as honoured — moomoo prompts the user — but harmless to ask.
  url.searchParams.set("scope", "trade:read quote:read");
  return url.toString();
}

async function postForm(body: Record<string, string>): Promise<TokenResponse> {
  const response = await fetch(`${MOOMOO_API_BASE}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(body).toString(),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`moomoo token endpoint returned ${response.status}: ${text}`);
  }

  return JSON.parse(text) as TokenResponse;
}

export async function exchangeCode(params: {
  code: string;
  clientId: string;
  redirectUri: string;
  verifier: string;
}): Promise<TokenResponse> {
  return postForm({
    grant_type: "authorization_code",
    code: params.code,
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    code_verifier: params.verifier,
  });
}

export async function refreshAccessToken(params: {
  refreshToken: string;
  clientId: string;
}): Promise<TokenResponse> {
  return postForm({
    grant_type: "refresh_token",
    refresh_token: params.refreshToken,
    client_id: params.clientId,
  });
}

export type RegisteredClient = {
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  scope: string;
};

/** Dynamic client registration — no developer portal or approval step. */
export async function registerClient(params: {
  redirectUris: string[];
  clientName: string;
}): Promise<RegisteredClient> {
  const response = await fetch(`${MOOMOO_API_BASE}/oauth2/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      redirect_uris: params.redirectUris,
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_name: params.clientName,
    }),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`moomoo client registration failed (${response.status}): ${text}`);
  }

  return JSON.parse(text) as RegisteredClient;
}
