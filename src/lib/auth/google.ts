import "server-only";
import { cookies } from "next/headers";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { decrypt, encrypt, parseKey } from "@/lib/crypto";
import type { DB } from "@/lib/db";
import { createPkcePair, createState } from "@/lib/moomoo/oauth";

/**
 * Signing in with Google.
 *
 * Only an identity: the site asks Google who somebody is (openid, email,
 * profile) and nothing else, never their mail or their files. The Google
 * account is found by its permanent id, not by its email address, and it
 * only signs somebody in once they have linked it from their own Account
 * page while signed in with their password. An email typed at sign-up was
 * never checked, so matching on it would let whoever owns that address into
 * somebody else's account. A Google sign-in that matches nobody becomes a
 * request to join, waiting for approval like any other.
 */

const FLOW_COOKIE = "fpd_google_flow";
const FLOW_TTL_SECONDS = 600;
const AUTHORIZE = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN = "https://oauth2.googleapis.com/token";
const USERINFO = "https://openidconnect.googleapis.com/v1/userinfo";

export type GoogleIntent = "signin" | "link";
type Flow = { state: string; verifier: string; intent: GoogleIntent };
export type GoogleProfile = { sub: string; email: string | null; emailVerified: boolean; name: string | null };

export function googleConfigured(): boolean {
  return Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

/** Must match, character for character, a redirect URI listed in Google's console. */
export function googleRedirectUri(): string {
  const configured = (process.env.APP_URL ?? "http://localhost:3000").trim();
  const base = /^https?:\/\//i.test(configured) ? configured : `https://${configured}`;
  return `${base.replace(/\/+$/, "")}/api/auth/google/callback`;
}

function key(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error("TOKEN_ENCRYPTION_KEY is not set.");
  return parseKey(raw);
}

/** Starts a sign-in: remembers the round trip in a sealed cookie and says where to go. */
export async function startGoogle(intent: GoogleIntent): Promise<string> {
  const { verifier, challenge } = createPkcePair();
  const state = createState();
  const cookieStore = await cookies();
  cookieStore.set(FLOW_COOKIE, JSON.stringify(encrypt(JSON.stringify({ state, verifier, intent } satisfies Flow), key())), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: FLOW_TTL_SECONDS,
  });
  const query = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID ?? "",
    redirect_uri: googleRedirectUri(),
    response_type: "code",
    scope: "openid email profile",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  return `${AUTHORIZE}?${query}`;
}

/** The round trip, used once: the state Google sent back must be the one this browser was given. */
export async function consumeGoogleFlow(returnedState: string | null): Promise<Flow | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(FLOW_COOKIE)?.value;
  cookieStore.delete(FLOW_COOKIE);
  if (!raw || !returnedState) return null;
  try {
    const flow = JSON.parse(decrypt(JSON.parse(raw), key())) as Flow;
    const a = Buffer.from(flow.state);
    const b = Buffer.from(returnedState);
    return a.length === b.length && timingSafeEqual(a, b) ? flow : null;
  } catch {
    return null;
  }
}

/** Trades the code for who the person is, straight from Google over TLS with the site's secret. */
export async function googleProfile(code: string, verifier: string): Promise<GoogleProfile> {
  const tokenResponse = await fetch(TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID ?? "",
      client_secret: process.env.GOOGLE_CLIENT_SECRET ?? "",
      redirect_uri: googleRedirectUri(),
      grant_type: "authorization_code",
      code_verifier: verifier,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!tokenResponse.ok) throw new Error(`Google token ${tokenResponse.status}`);
  const { access_token: accessToken } = (await tokenResponse.json()) as { access_token?: string };
  if (!accessToken) throw new Error("Google sent no access token");

  const infoResponse = await fetch(USERINFO, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!infoResponse.ok) throw new Error(`Google userinfo ${infoResponse.status}`);
  const info = (await infoResponse.json()) as { sub?: string; email?: string; email_verified?: boolean; name?: string };
  if (!info.sub) throw new Error("Google sent no account id");
  return {
    sub: info.sub,
    email: info.email ?? null,
    emailVerified: info.email_verified === true,
    name: info.name ?? null,
  };
}

export async function linkedUser(db: DB, sub: string): Promise<string | null> {
  const row = await db.get<{ user_id: string }>(
    `SELECT user_id FROM user_identities WHERE provider = 'google' AND subject = ?`,
    [sub],
  );
  return row?.user_id ?? null;
}

export async function linkGoogle(db: DB, userId: string, profile: GoogleProfile, now: Date = new Date()): Promise<void> {
  await db.run(
    `INSERT INTO user_identities (provider, subject, user_id, email, created_at) VALUES ('google', ?, ?, ?, ?)
     ON CONFLICT (provider, subject) DO NOTHING`,
    [profile.sub, userId, profile.emailVerified ? profile.email : null, now.toISOString()],
  );
}

export async function googleFor(db: DB, userId: string): Promise<{ email: string | null } | null> {
  const row = await db.get<{ email: string | null }>(
    `SELECT email FROM user_identities WHERE provider = 'google' AND user_id = ?`,
    [userId],
  );
  return row ?? null;
}

export async function unlinkGoogle(db: DB, userId: string): Promise<void> {
  await db.run(`DELETE FROM user_identities WHERE provider = 'google' AND user_id = ?`, [userId]);
}

/** A username for somebody joining with Google: from their address, made unique. */
export async function usernameFor(db: DB, profile: GoogleProfile): Promise<string> {
  const base =
    (profile.email?.split("@")[0] ?? profile.name ?? "member")
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .replace(/^[^a-z]+/, "")
      .slice(0, 24) || "member";
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const candidate = attempt === 0 ? base : `${base}-${attempt + 1}`;
    const taken = await db.get(`SELECT 1 FROM users WHERE username = ?`, [candidate]);
    if (!taken) return candidate;
  }
  return `${base}-${randomBytes(3).toString("hex")}`;
}

/** A password nobody knows, for an account that signs in with Google. */
export function unusablePassword(): string {
  return randomBytes(32).toString("base64url");
}
