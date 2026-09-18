"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { loginSchema } from "@/lib/schemas";
import { logger } from "@/lib/logger";
import { recordActivity } from "@/lib/activity";
import { verifyPassword } from "@/lib/auth/password";
import {
  checkRateLimit,
  clearFailedAttempts,
  recordFailedAttempt,
} from "@/lib/auth/rate-limit";
import {
  SESSION_COOKIE,
  SESSION_TTL_DAYS,
  createSession,
  sessionCookieOptions,
} from "@/lib/auth/session";
import { currentLocale } from "@/lib/i18n/server";
import { getDictionary } from "@/lib/i18n/dictionaries";

export type LoginState = { error?: string };

type UserRow = {
  id: string;
  username: string;
  password_hash: string;
  disabled_at: string | null;
};

/**
 * A Server Action rather than a fetch handler, so the form still posts when
 * JavaScript has not hydrated. The client-side fallback was a native GET, which
 * put the password in the URL — and URLs reach access logs and history.
 */
export async function loginAction(
  _previous: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const t = getDictionary(await currentLocale());

  const parsed = loginSchema.safeParse({
    username: formData.get("username"),
    password: formData.get("password"),
  });

  if (!parsed.success) return { error: t.login.invalid };

  const { username, password } = parsed.data;
  const db = await getDb();

  const limit = await checkRateLimit(db, username);
  if (limit.blocked) {
    logger.warn("auth.login.rate_limited", { username });
    return { error: t.login.tooMany };
  }

  const user = await db.get<UserRow>(
    `SELECT id, username, password_hash, disabled_at FROM users WHERE username = ?`,
    [username],
  );

  if (!user || user.disabled_at) {
    await recordFailedAttempt(db, username);
    logger.warn("auth.login.failure", { username, reason: "unknown_or_disabled" });
    return { error: t.login.invalid };
  }

  if (!(await verifyPassword(user.password_hash, password))) {
    await recordFailedAttempt(db, username);
    logger.warn("auth.login.failure", { username, reason: "bad_password" });
    return { error: t.login.invalid };
  }

  await clearFailedAttempts(db, username);
  await recordActivity(db, { userId: user.id, username, kind: "login" });

  const { token } = await createSession(db, user.id);
  const cookieStore = await cookies();
  cookieStore.set(
    SESSION_COOKIE,
    token,
    sessionCookieOptions(SESSION_TTL_DAYS * 86_400),
  );

  logger.info("auth.login.success", { username });

  // redirect throws, so it must sit outside any try/catch above.
  redirect("/dashboard");
}
