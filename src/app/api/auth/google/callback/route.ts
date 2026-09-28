import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/auth/guards";
import { consumeGoogleFlow, googleProfile, linkedUser, linkGoogle, unusablePassword, usernameFor } from "@/lib/auth/google";
import { SESSION_COOKIE, SESSION_TTL_DAYS, createSession, sessionCookieOptions } from "@/lib/auth/session";
import { recordActivity } from "@/lib/activity";
import { register } from "@/lib/accounts";
import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * Back from Google.
 *
 * Linking attaches the Google account to whoever is signed in. Signing in
 * finds the account it was linked to; a Google account linked to nobody asks
 * to join and waits for approval, and is never matched to an existing
 * account by its email address.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const to = (path: string) => Response.redirect(new URL(path, request.url), 303);

  const flow = await consumeGoogleFlow(url.searchParams.get("state"));
  const code = url.searchParams.get("code");
  if (!flow || !code) return to(url.searchParams.get("error") ? "/login?google=cancelled" : "/login?google=failed");

  let profile;
  try {
    profile = await googleProfile(code, flow.verifier);
  } catch (error) {
    logger.warn("auth.google.failed", { reason: error instanceof Error ? error.message : "unknown" });
    return to(flow.intent === "link" ? "/account?google=failed" : "/login?google=failed");
  }

  const db = await getDb();
  const owner = await linkedUser(db, profile.sub);

  if (flow.intent === "link") {
    const me = await getCurrentUser();
    if (!me) return to("/login");
    if (owner && owner !== me.id) return to("/account?google=taken");
    await linkGoogle(db, me.id, profile);
    return to("/account?google=linked");
  }

  let userId = owner;
  if (!userId) {
    // Nobody has linked this Google account: a request to join, like the
    // sign-up form, waiting for approval.
    const username = await usernameFor(db, profile);
    const created = await register(db, {
      username,
      displayName: profile.name ?? username,
      password: unusablePassword(),
      email: profile.emailVerified ? (profile.email ?? undefined) : undefined,
      reason: "Signed up with Google",
    });
    await linkGoogle(db, created.id, profile);
    userId = created.id;
    logger.info("auth.google.requested", { username });
  }

  const user = await db.get<{ id: string; username: string; disabled_at: string | null }>(
    `SELECT id, username, disabled_at FROM users WHERE id = ?`,
    [userId],
  );
  if (!user || user.disabled_at) return to("/login?google=failed");

  await recordActivity(db, { userId: user.id, username: user.username, kind: "login" });
  const { token } = await createSession(db, user.id);
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions(SESSION_TTL_DAYS * 86_400));
  return to("/");
}
