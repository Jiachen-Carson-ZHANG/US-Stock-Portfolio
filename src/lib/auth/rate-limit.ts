import type { DB } from "@/lib/db";

export const MAX_FAILED_ATTEMPTS = 5;
export const COOLDOWN_MINUTES = 15;

export type RateLimitState = {
  blocked: boolean;
  retryAfterSeconds: number;
};

function windowStart(now: Date): string {
  return new Date(now.getTime() - COOLDOWN_MINUTES * 60_000).toISOString();
}

export function checkRateLimit(
  db: DB,
  username: string,
  now: Date = new Date(),
): RateLimitState {
  const rows = db
    .prepare(
      `SELECT attempted_at FROM login_attempts
       WHERE username = ? AND attempted_at > ?
       ORDER BY attempted_at ASC`,
    )
    .all(username, windowStart(now)) as { attempted_at: string }[];

  if (rows.length < MAX_FAILED_ATTEMPTS) {
    return { blocked: false, retryAfterSeconds: 0 };
  }

  const oldest = new Date(rows[0].attempted_at).getTime();
  const unblockAt = oldest + COOLDOWN_MINUTES * 60_000;
  return {
    blocked: true,
    retryAfterSeconds: Math.max(1, Math.ceil((unblockAt - now.getTime()) / 1000)),
  };
}

export function recordFailedAttempt(
  db: DB,
  username: string,
  now: Date = new Date(),
): void {
  db.prepare(`INSERT INTO login_attempts (username, attempted_at) VALUES (?, ?)`).run(
    username,
    now.toISOString(),
  );
}

export function clearFailedAttempts(db: DB, username: string): void {
  db.prepare(`DELETE FROM login_attempts WHERE username = ?`).run(username);
}
