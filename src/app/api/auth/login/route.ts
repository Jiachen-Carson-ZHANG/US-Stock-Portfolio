import { cookies } from "next/headers";
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

type UserRow = {
  id: string;
  username: string;
  password_hash: string;
  disabled_at: string | null;
};

/** Identical rejection for unknown user, wrong password and disabled account. */
function invalidCredentials() {
  return Response.json(
    { error: "Invalid username or password" },
    { status: 401 },
  );
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const { username, password } = parsed.data;
  const db = await getDb();

  const limit = await checkRateLimit(db, username);
  if (limit.blocked) {
    logger.warn("auth.login.rate_limited", { username });
    return Response.json(
      { error: "Too many attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const user = await db.get<UserRow>(
    `SELECT id, username, password_hash, disabled_at FROM users WHERE username = ?`,
    [username],
  );

  if (!user || user.disabled_at) {
    await recordFailedAttempt(db, username);
    logger.warn("auth.login.failure", { username, reason: "unknown_or_disabled" });
    return invalidCredentials();
  }

  if (!(await verifyPassword(user.password_hash, password))) {
    await recordFailedAttempt(db, username);
    logger.warn("auth.login.failure", { username, reason: "bad_password" });
    return invalidCredentials();
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
  return Response.json({ ok: true });
}
