import type { DB } from "@/lib/db";

export const MAX_FAILED_ATTEMPTS = 5;
export const COOLDOWN_MINUTES = 15;

/**
 * Sign-ups get their own, looser limit.
 *
 * A wrong password five times is somebody guessing. Five sign-ups is a
 * household getting set up on a Sunday afternoon, and stopping them mid-way
 * is worse than the abuse it prevents — every account still waits for
 * approval, so the cost of one extra is a line in a queue.
 */
export const MAX_REGISTRATIONS = 10;

export type RateLimitState = {
  blocked: boolean;
  retryAfterSeconds: number;
};

function windowStart(now: Date): string {
  return new Date(now.getTime() - COOLDOWN_MINUTES * 60_000).toISOString();
}

export async function checkRateLimit(
  db: DB,
  username: string,
  now: Date = new Date(),
  limit: number = MAX_FAILED_ATTEMPTS,
): Promise<RateLimitState> {
  const rows = await db.all<{ attempted_at: string }>(
    `SELECT attempted_at FROM login_attempts
      WHERE username = ? AND attempted_at > ?
      ORDER BY attempted_at ASC`,
    [username, windowStart(now)],
  );

  if (rows.length < limit) {
    return { blocked: false, retryAfterSeconds: 0 };
  }

  const oldest = new Date(rows[0].attempted_at).getTime();
  const unblockAt = oldest + COOLDOWN_MINUTES * 60_000;
  return {
    blocked: true,
    retryAfterSeconds: Math.max(1, Math.ceil((unblockAt - now.getTime()) / 1000)),
  };
}

export async function recordFailedAttempt(
  db: DB,
  username: string,
  now: Date = new Date(),
): Promise<void> {
  await db.run(`INSERT INTO login_attempts (username, attempted_at) VALUES (?, ?)`, [
    username,
    now.toISOString(),
  ]);
}

export async function clearFailedAttempts(db: DB, username: string): Promise<void> {
  await db.run(`DELETE FROM login_attempts WHERE username = ?`, [username]);
}
