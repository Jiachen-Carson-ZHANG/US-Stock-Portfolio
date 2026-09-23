import { randomUUID } from "node:crypto";
import type { DB } from "@/lib/db";
import { notify } from "@/lib/notifications";
import { canRead } from "@/lib/portfolios";
import type { AuthUser } from "@/lib/auth/session";

/**
 * Following somebody.
 *
 * Following is one-directional and needs no permission: it says "tell me when
 * this person does something", not "let me see their account". What you are
 * then told about is still filtered by what you were already allowed to see,
 * so following somebody can never become a way around the access rule. If a
 * portfolio is closed to you, its trades stay closed to you whether or not
 * you follow its owner.
 */
export async function subscribe(
  db: DB,
  subscriberId: string,
  subjectId: string,
  now: Date = new Date(),
): Promise<boolean> {
  if (subscriberId === subjectId) return false;
  const result = await db.run(
    `INSERT INTO subscriptions (id, subscriber_id, subject_id, created_at)
     VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING`,
    [randomUUID(), subscriberId, subjectId, now.toISOString()],
  );
  return result.changes > 0;
}

export async function unsubscribe(
  db: DB,
  subscriberId: string,
  subjectId: string,
): Promise<boolean> {
  const result = await db.run(
    `DELETE FROM subscriptions WHERE subscriber_id = ? AND subject_id = ?`,
    [subscriberId, subjectId],
  );
  return result.changes > 0;
}

/** Everyone this person is following. */
export async function following(db: DB, subscriberId: string): Promise<string[]> {
  const rows = await db.all<{ subject_id: string }>(
    `SELECT subject_id FROM subscriptions WHERE subscriber_id = ?`,
    [subscriberId],
  );
  return rows.map((row) => row.subject_id);
}

type Subscriber = {
  id: string;
  username: string;
  display_name: string;
  role: string;
  status: string;
  disabled_at: string | null;
};

/**
 * Tells everyone following this person that something happened.
 *
 * `portfolioId` is the gate. When an event belongs to a portfolio, only
 * subscribers who could already open that portfolio hear about it — the same
 * rule the rest of the app uses, applied at the moment of sending rather than
 * trusted to the reader. Events that belong to no portfolio, like a post in
 * the playground, go to everyone following, because the playground is a room
 * everybody is already in.
 *
 * A failure to notify is never allowed to fail the thing that happened. A
 * trade that went through is a fact; a missed bell is an inconvenience.
 */
export async function notifyFollowers(
  db: DB,
  event: {
    subjectId: string;
    kind: string;
    title: string;
    body?: string | null;
    link?: string | null;
    /** The portfolio the event belongs to, when it belongs to one. */
    portfolioId?: string | null;
  },
  now: Date = new Date(),
): Promise<number> {
  const rows = await db.all<Subscriber>(
    `SELECT u.id, u.username, u.display_name, u.role, u.status, u.disabled_at
       FROM subscriptions s
       JOIN users u ON u.id = s.subscriber_id
      WHERE s.subject_id = ?
        AND u.status = 'active'
        AND u.disabled_at IS NULL`,
    [event.subjectId],
  );

  let sent = 0;
  for (const row of rows) {
    if (event.portfolioId) {
      const reader: AuthUser = {
        id: row.id,
        username: row.username,
        displayName: row.display_name,
        role: row.role as AuthUser["role"],
        status: row.status as AuthUser["status"],
      };
      if (!(await canRead(db, reader, event.portfolioId))) continue;
    }

    await notify(
      db,
      {
        userId: row.id,
        kind: event.kind,
        title: event.title,
        body: event.body ?? null,
        link: event.link ?? null,
      },
      now,
    );
    sent += 1;
  }

  return sent;
}
