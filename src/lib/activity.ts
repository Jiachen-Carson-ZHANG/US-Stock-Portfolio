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
  | "password_reset"
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
/** What somebody opened or watched: private to them, like their accounts. */
const BROWSING = ["view_position", "view_page", "watchlist_add", "watchlist_remove"];

/**
 * The recent log, as the person reading it may see it: sign-ins, approvals
 * and the like for everybody, but what others opened or put on a watchlist
 * only for the reader themselves. Those name holdings, and holdings are no
 * business of the site's administrator.
 */
export async function recentActivity(db: DB, limit = 50, viewer?: string): Promise<ActivityEvent[]> {
  return db.all<ActivityEvent>(
    `SELECT username, kind, target, detail, created_at AS "createdAt"
       FROM activity_events
      WHERE kind NOT IN (${BROWSING.map(() => "?").join(", ")}) OR username = ?
      ORDER BY created_at DESC LIMIT ?`,
    [...BROWSING, viewer ?? "", limit],
  );
}

export type AssetInterest = {
  target: string;
  views: number;
  viewers: number;
};

/**
 * What other people open in your accounts, most first.
 *
 * Only views inside the accounts named, which are the reader's own, and only
 * other people's. Everybody's views pooled together said which shares each
 * person was looking at in their own account, which is as private as what
 * they hold.
 */
export async function mostViewedAssets(
  db: DB,
  scope: { accounts: string[]; viewer: string },
  limit = 12,
): Promise<AssetInterest[]> {
  if (scope.accounts.length === 0) return [];
  // COUNT returns bigint, which the driver hands back as a string to protect
  // precision. These counts are small, so casting to int in SQL keeps the
  // declared `number` type honest.
  return db.all<AssetInterest>(
    `SELECT target,
            COUNT(*)::int AS views,
            COUNT(DISTINCT username)::int AS viewers
       FROM activity_events
      WHERE kind = 'view_position' AND target IS NOT NULL
        AND detail IN (${scope.accounts.map(() => "?").join(", ")})
        AND username <> ?
      GROUP BY target
      ORDER BY views DESC
      LIMIT ?`,
    [...scope.accounts, scope.viewer, limit],
  );
}

export type MemberActivity = {
  username: string;
  logins: number;
  views: number;
  lastSeen: string | null;
};

/**
 * Each member's logins and views — members who still have an account only.
 * The list was built from the activity log alone, so somebody removed kept
 * appearing in it for as long as their old logins did.
 */
export async function activityByMember(db: DB): Promise<MemberActivity[]> {
  return db.all<MemberActivity>(
    `SELECT a.username,
            SUM(CASE WHEN a.kind = 'login' THEN 1 ELSE 0 END)::int AS logins,
            SUM(CASE WHEN a.kind = 'view_position' THEN 1 ELSE 0 END)::int AS views,
            MAX(a.created_at) AS "lastSeen"
       FROM activity_events a
       JOIN users u ON u.username = a.username
      GROUP BY a.username
      ORDER BY "lastSeen" DESC`,
  );
}
