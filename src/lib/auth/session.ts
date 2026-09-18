import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { DB } from "@/lib/db";

export const SESSION_COOKIE = "fpd_session";
export const SESSION_TTL_DAYS = 30;

export type UserRole = "owner" | "viewer";

export type AuthUser = {
  id: string;
  username: string;
  displayName: string;
  role: UserRole;
};

type UserRow = {
  id: string;
  username: string;
  display_name: string;
  role: UserRole;
  disabled_at: string | null;
};

/**
 * Session tokens are 256-bit random values, so a fast digest is sufficient —
 * only the digest is stored, keeping DB read access from yielding live tokens.
 */
function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

export function createSession(
  db: DB,
  userId: string,
  now: Date = new Date(),
): { token: string; expiresAt: Date } {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + SESSION_TTL_DAYS * 86_400_000);

  db.prepare(
    `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, last_seen_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    userId,
    hashToken(token),
    now.toISOString(),
    expiresAt.toISOString(),
    now.toISOString(),
  );

  return { token, expiresAt };
}

export function validateSession(
  db: DB,
  token: string | undefined,
  now: Date = new Date(),
): AuthUser | null {
  if (!token) return null;

  const row = db
    .prepare(
      `SELECT u.id, u.username, u.display_name, u.role, u.disabled_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.token_hash = ?
         AND s.revoked_at IS NULL
         AND s.expires_at > ?`,
    )
    .get(hashToken(token), now.toISOString()) as UserRow | undefined;

  if (!row || row.disabled_at) return null;

  db.prepare(`UPDATE sessions SET last_seen_at = ? WHERE token_hash = ?`).run(
    now.toISOString(),
    hashToken(token),
  );

  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
  };
}

export function revokeSession(
  db: DB,
  token: string,
  now: Date = new Date(),
): void {
  db.prepare(
    `UPDATE sessions SET revoked_at = ? WHERE token_hash = ? AND revoked_at IS NULL`,
  ).run(now.toISOString(), hashToken(token));
}

export function revokeAllSessionsForUser(
  db: DB,
  userId: string,
  now: Date = new Date(),
): number {
  const result = db
    .prepare(
      `UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`,
    )
    .run(now.toISOString(), userId);
  return result.changes;
}
