import { cookies } from "next/headers";
import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";
import { recordActivity } from "@/lib/activity";
import { authenticateRequest, isOpenAccess, unauthorized } from "@/lib/auth/guards";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import {
  checkRateLimit,
  clearFailedAttempts,
  recordFailedAttempt,
} from "@/lib/auth/rate-limit";
import { SESSION_COOKIE, revokeOtherSessionsForUser } from "@/lib/auth/session";
import { changePasswordSchema } from "@/lib/schemas";

/**
 * Changes the signed-in user's own password.
 *
 * Deliberately has no user id parameter: you can only ever change your own.
 * An owner can disable an account or revoke its sessions, but cannot set
 * someone else's password through the app — that stays a deployment action,
 * so a password is never silently changed by another family member.
 */
export async function POST(request: Request) {
  const user = await authenticateRequest();
  if (!user) return unauthorized();

  if (isOpenAccess()) {
    return Response.json(
      {
        error:
          "Sign-in is disabled on this deployment, so there is no password to change.",
      },
      { status: 409 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = changePasswordSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request body" },
      { status: 400 },
    );
  }

  const { currentPassword, newPassword } = parsed.data;

  if (newPassword === currentPassword) {
    return Response.json(
      { error: "The new password is the same as the current one." },
      { status: 400 },
    );
  }
  if (newPassword.toLowerCase().includes(user.username.toLowerCase())) {
    return Response.json(
      { error: "The new password must not contain your username." },
      { status: 400 },
    );
  }

  const db = await getDb();

  // Shares the login limiter, so this endpoint cannot be used to guess the
  // current password faster than the login form allows.
  const limit = await checkRateLimit(db, user.username);
  if (limit.blocked) {
    logger.warn("auth.password_change.rate_limited", { username: user.username });
    return Response.json(
      { error: "Too many attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds) } },
    );
  }

  const row = await db.get<{ password_hash: string }>(
    `SELECT password_hash FROM users WHERE id = ?`,
    [user.id],
  );
  if (!row) return unauthorized();

  if (!(await verifyPassword(row.password_hash, currentPassword))) {
    await recordFailedAttempt(db, user.username);
    logger.warn("auth.password_change.failure", { username: user.username });
    return Response.json(
      { error: "The current password is not correct." },
      { status: 403 },
    );
  }

  await db.run(`UPDATE users SET password_hash = ? WHERE id = ?`, [
    await hashPassword(newPassword),
    user.id,
  ]);
  await clearFailedAttempts(db, user.username);

  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  const revoked = await revokeOtherSessionsForUser(db, user.id, token);

  // Recorded so a change is visible afterwards even to the person it happened
  // to — an unexpected entry here is how you find out someone else did it.
  await recordActivity(db, {
    userId: user.id,
    username: user.username,
    kind: "password_change",
    detail: `${revoked} other session${revoked === 1 ? "" : "s"} signed out`,
  });
  logger.info("auth.password_change.success", { username: user.username, revoked });

  return Response.json({ ok: true, revoked });
}
