import { randomUUID } from "node:crypto";
import type { DB } from "@/lib/db";

export type ActivityKind =
  | "login"
  | "logout"
  | "view_position"
  | "view_page"
  | "watchlist_add"
  | "watchlist_remove";

export type ActivityEvent = {
  username: string;
  kind: ActivityKind;
  target: string | null;
  detail: string | null;
  createdAt: string;
};

export function recordActivity(
  db: DB,
  event: {
    userId: string | null;
    username: string;
    kind: ActivityKind;
    target?: string | null;
    detail?: string | null;
  },
  now: Date = new Date(),
): void {
  db.prepare(
    `INSERT INTO activity_events (id, user_id, username, kind, target, detail, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomUUID(),
    event.userId,
    event.username,
    event.kind,
    event.target ?? null,
    event.detail ?? null,
    now.toISOString(),
  );
}

export function recentActivity(db: DB, limit = 50): ActivityEvent[] {
  return db
    .prepare(
      `SELECT username, kind, target, detail, created_at AS createdAt
       FROM activity_events ORDER BY created_at DESC LIMIT ?`,
    )
    .all(limit) as ActivityEvent[];
}

export type AssetInterest = {
  target: string;
  views: number;
  viewers: number;
};

/** Which holdings the family opens most — the "what are they watching" view. */
export function mostViewedAssets(db: DB, limit = 12): AssetInterest[] {
  return db
    .prepare(
      `SELECT target, COUNT(*) AS views, COUNT(DISTINCT username) AS viewers
       FROM activity_events
       WHERE kind = 'view_position' AND target IS NOT NULL
       GROUP BY target
       ORDER BY views DESC
       LIMIT ?`,
    )
    .all(limit) as AssetInterest[];
}

export type MemberActivity = {
  username: string;
  logins: number;
  views: number;
  lastSeen: string | null;
};

export function activityByMember(db: DB): MemberActivity[] {
  return db
    .prepare(
      `SELECT username,
              SUM(CASE WHEN kind = 'login' THEN 1 ELSE 0 END) AS logins,
              SUM(CASE WHEN kind = 'view_position' THEN 1 ELSE 0 END) AS views,
              MAX(created_at) AS lastSeen
       FROM activity_events
       GROUP BY username
       ORDER BY lastSeen DESC`,
    )
    .all() as MemberActivity[];
}
