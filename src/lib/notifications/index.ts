import { randomUUID } from "node:crypto";
import type { DB } from "@/lib/db";

/** Answered from the bell, or still waiting for an answer. */
export type NotificationDecision = "approved" | "declined";

export type Notification = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  /**
   * What this notification is about: the account waiting to be let in, or the
   * access request waiting to be answered. Present only on the kinds that ask
   * a question, and it is what lets the bell answer one without first sending
   * you to a settings page to find it again.
   */
  subjectId: string | null;
  decision: NotificationDecision | null;
  decidedAt: string | null;
  createdAt: string;
  readAt: string | null;
};

type Row = {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  link: string | null;
  subject_id: string | null;
  decision: NotificationDecision | null;
  decided_at: string | null;
  created_at: string;
  read_at: string | null;
};

const toNotification = (row: Row): Notification => ({
  id: row.id,
  kind: row.kind,
  title: row.title,
  body: row.body,
  link: row.link,
  subjectId: row.subject_id,
  decision: row.decision,
  decidedAt: row.decided_at,
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
    subjectId?: string | null;
  },
  now: Date = new Date(),
): Promise<void> {
  await db.run(
    `INSERT INTO notifications
       (id, user_id, kind, title, body, link, subject_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      randomUUID(),
      input.userId,
      input.kind,
      input.title,
      input.body ?? null,
      input.link ?? null,
      input.subjectId ?? null,
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
    `SELECT id, kind, title, body, link, subject_id, decision, decided_at,
            created_at, read_at
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

/**
 * Finds a question this person was actually asked.
 *
 * Scoped by user id as well as notification id, so somebody who guesses an id
 * approves nothing: the bell is a shortcut to a decision they could already
 * make, never a way around who may make it.
 */
export async function findNotification(
  db: DB,
  userId: string,
  id: string,
): Promise<Notification | null> {
  const row = await db.get<Row>(
    `SELECT id, kind, title, body, link, subject_id, decision, decided_at,
            created_at, read_at
       FROM notifications WHERE id = ? AND user_id = ?`,
    [id, userId],
  );
  return row ? toNotification(row) : null;
}

/**
 * Writes the answer onto the notification itself, so the bell keeps a record
 * rather than a question that silently stops being a question.
 */
export async function recordDecision(
  db: DB,
  userId: string,
  id: string,
  decision: NotificationDecision,
  now: Date = new Date(),
): Promise<void> {
  await db.run(
    `UPDATE notifications
        SET decision = ?, decided_at = ?, read_at = COALESCE(read_at, ?)
      WHERE id = ? AND user_id = ?`,
    [decision, now.toISOString(), now.toISOString(), id, userId],
  );
}
