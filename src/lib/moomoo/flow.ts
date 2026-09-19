import "server-only";
import { cookies } from "next/headers";
import { decrypt, encrypt, parseKey } from "@/lib/crypto";

const FLOW_COOKIE = "fpd_moomoo_flow";
const FLOW_TTL_SECONDS = 600;

export type PendingFlow = {
  state: string;
  verifier: string;
};

function key(): Buffer {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) throw new Error("TOKEN_ENCRYPTION_KEY is not set.");
  return parseKey(raw);
}

/**
 * moomoo compares the redirect URI character for character, so a malformed one
 * fails at the consent screen with nothing useful in the logs. Hosting panels
 * invite pasting a bare hostname, which would yield a relative path here, so
 * the scheme is supplied when it is missing rather than trusted to be there.
 */
export function redirectUri(): string {
  const configured = (process.env.APP_URL ?? "http://localhost:3000").trim();
  const base = /^https?:\/\//i.test(configured)
    ? configured
    : `https://${configured}`;
  return `${base.replace(/\/+$/, "")}/api/broker/moomoo/callback`;
}

/**
 * The PKCE verifier must survive the round trip to moomoo without reaching the
 * browser in readable form, so it rides in an encrypted HttpOnly cookie rather
 * than a table — it is single-use and expires in minutes.
 */
export async function storePendingFlow(flow: PendingFlow): Promise<void> {
  const payload = encrypt(JSON.stringify(flow), key());
  const cookieStore = await cookies();

  cookieStore.set(FLOW_COOKIE, JSON.stringify(payload), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: FLOW_TTL_SECONDS,
  });
}

export async function consumePendingFlow(): Promise<PendingFlow | null> {
  const cookieStore = await cookies();
  const raw = cookieStore.get(FLOW_COOKIE)?.value;
  cookieStore.delete(FLOW_COOKIE);

  if (!raw) return null;

  try {
    return JSON.parse(decrypt(JSON.parse(raw), key())) as PendingFlow;
  } catch {
    return null;
  }
}
