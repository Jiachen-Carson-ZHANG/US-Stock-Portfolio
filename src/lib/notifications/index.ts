import { randomUUID } from "node:crypto";
import type { DB } from "@/lib/db";

export type Notification = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  createdAt: string;
  readAt: string | null;
};

type Row = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  created_at: string;
  read_at: string | null;
};

const toNotification = (row: Row): Notification => ({
  id: row.id,
  kind: row.kind,
  title: row.title,
  body: row.body,
  link: row.link,
  createdAt: row.created_at,
  readAt: row.read_at,
});

/**
 * In-app only, deliberately.
 *
 * Email would mean holding addresses and sending on someone's behalf, and
 * the people using this open the app most days anyway. A bell that is honest
 * about what happened beats a mail nobody reads.
 */
export async function notify(
  db: DB,
  input: {
    userId: string;
    kind: string;
    title: string;
    body?: string | null;
    link?: string | null;
  },
  now: Date = new Date(),
): Promise<void> {
  await db.run(
    `INSERT INTO notifications (id, user_id, kind, title, body, link, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      input.userId,
      input.kind,
      input.title,
      input.body ?? null,
      input.link ?? null,
      now.toISOString(),
    ],
  );
}

export async function notificationsFor(
  db: DB,
  userId: string,
  limit = 20,
): Promise<Notification[]> {
  const rows = await db.all<Row>(
    `SELECT id, kind, title, body, link, created_at, read_at
       FROM notifications WHERE user_id = ?
      ORDER BY created_at DESC LIMIT ?`,
    [userId, limit],
  );
  return rows.map(toNotification);
}

export async function unreadCount(db: DB, userId: string): Promise<number> {
  const row = await db.get<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM notifications WHERE user_id = ? AND read_at IS NULL`,
    [userId],
  );
  return row?.n ?? 0;
}

/** Scoped by user as well as id, so a guessed id marks nothing of anyone else's. */
export async function markRead(
  db: DB,
  userId: string,
  id: string | null,
  now: Date = new Date(),
): Promise<number> {
  const result = id
    ? await db.run(
        `UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL`,
        [now.toISOString(), id, userId],
      )
    : await db.run(
        `UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL`,
        [now.toISOString(), userId],
      );
  return result.changes;
}
