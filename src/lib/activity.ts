import { randomUUID } from "node:crypto";
import type { DB } from "@/lib/db";

export type ActivityKind =
  | "login"
  | "logout"
  | "password_change"
  | "view_position"
  | "view_page"
  | "watchlist_add"
  | "watchlist_remove"
  | "broker_connect"
  | "broker_disconnect"
  | "sync"
  | "ai_insight"
  | "portfolio_create"
  | "portfolio_remove"
  | "access_grant"
  | "access_revoke"
  | "mock_trade"
  | "account_approve"
  | "account_decline"
  | "account_remove"
  | "playground_post"
  | "playground_reply";

export type ActivityEvent = {
  username: string;
  kind: ActivityKind;
  target: string | null;
  detail: string | null;
  createdAt: string;
};

export async function recordActivity(
  db: DB,
  event: {
    userId: string | null;
    username: string;
    kind: ActivityKind;
    target?: string | null;
    detail?: string | null;
  },
  now: Date = new Date(),
): Promise<void> {
  await db.run(
    `INSERT INTO activity_events (id, user_id, username, kind, target, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      event.userId,
      event.username,
      event.kind,
      event.target ?? null,
      event.detail ?? null,
      now.toISOString(),
    ],
  );
}

// Postgres folds unquoted identifiers to lower case, so a bare `AS createdAt`
// would arrive as `createdat` and read as undefined. Camel-cased aliases are
// therefore double-quoted throughout this file.
export async function recentActivity(db: DB, limit = 50): Promise<ActivityEvent[]> {
  return db.all<ActivityEvent>(
    `SELECT username, kind, target, detail, created_at AS "createdAt"
       FROM activity_events ORDER BY created_at DESC LIMIT ?`,
    [limit],
  );
}

export type AssetInterest = {
  target: string;
  views: number;
  viewers: number;
};

/** Which holdings the family opens most — the "what are they watching" view. */
export async function mostViewedAssets(db: DB, limit = 12): Promise<AssetInterest[]> {
  // COUNT returns bigint, which the driver hands back as a string to protect
  // precision. These counts are small, so casting to int in SQL keeps the
  // declared `number` type honest.
  return db.all<AssetInterest>(
    `SELECT target,
            COUNT(*)::int AS views,
            COUNT(DISTINCT username)::int AS viewers
       FROM activity_events
      WHERE kind = 'view_position' AND target IS NOT NULL
      GROUP BY target
      ORDER BY views DESC
      LIMIT ?`,
    [limit],
  );
}

export type MemberActivity = {
  username: string;
  logins: number;
  views: number;
  lastSeen: string | null;
};

export async function activityByMember(db: DB): Promise<MemberActivity[]> {
  return db.all<MemberActivity>(
    `SELECT username,
            SUM(CASE WHEN kind = 'login' THEN 1 ELSE 0 END)::int AS logins,
            SUM(CASE WHEN kind = 'view_position' THEN 1 ELSE 0 END)::int AS views,
            MAX(created_at) AS "lastSeen"
       FROM activity_events
      GROUP BY username
      ORDER BY "lastSeen" DESC`,
  );
}
