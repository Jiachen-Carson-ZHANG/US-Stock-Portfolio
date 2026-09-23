import { randomUUID } from "node:crypto";
import type { DB } from "@/lib/db";

/**
 * When somebody thinks the idea is for.
 *
 * The two that were asked for — what to watch over the next few months, and
 * what to watch over the next year — plus nothing at all, which is what most
 * conversation is and should not be forced into a box.
 */
export const HORIZONS = ["three-months", "one-year"] as const;
export type Horizon = (typeof HORIZONS)[number];

export type Post = {
  id: string;
  userId: string;
  author: string;
  symbol: string | null;
  horizon: Horizon | null;
  body: string;
  createdAt: string;
  replies: Post[];
};

type Row = {
  id: string;
  parent_id: string | null;
  user_id: string;
  author: string;
  symbol: string | null;
  horizon: Horizon | null;
  body: string;
  created_at: string;
};

const MAX_BODY = 2000;
const MAX_THREADS = 100;

function toPost(row: Row): Post {
  return {
    id: row.id,
    userId: row.user_id,
    author: row.author,
    symbol: row.symbol,
    horizon: row.horizon,
    body: row.body,
    createdAt: row.created_at,
    replies: [],
  };
}

/**
 * The whole room, newest conversation first.
 *
 * One query rather than one per thread: a hundred threads asked for their own
 * replies would be a hundred round trips, which on a database an ocean away
 * is the difference between instant and unusable.
 */
export async function readRoom(db: DB): Promise<Post[]> {
  const rows = await db.all<Row>(
    `SELECT id, parent_id, user_id, author, symbol, horizon, body, created_at
       FROM playground_posts
      ORDER BY created_at DESC
      LIMIT ?`,
    [MAX_THREADS * 10],
  );

  const byId = new Map<string, Post>();
  for (const row of rows) byId.set(row.id, toPost(row));

  const threads: Post[] = [];
  // Oldest first within a thread: a conversation reads downwards.
  for (const row of [...rows].reverse()) {
    const post = byId.get(row.id)!;
    if (row.parent_id === null) {
      threads.push(post);
      continue;
    }
    // A reply whose parent fell outside the window is dropped rather than
    // shown adrift at the top level, where it would read as a new topic.
    byId.get(row.parent_id)?.replies.push(post);
  }

  return threads.reverse().slice(0, MAX_THREADS);
}

export class PostError extends Error {}

export async function addPost(
  db: DB,
  input: {
    userId: string;
    author: string;
    body: string;
    symbol?: string | null;
    horizon?: Horizon | null;
    parentId?: string | null;
  },
  now: Date = new Date(),
): Promise<Post> {
  const body = input.body.trim();
  if (!body) throw new PostError("Write something first.");
  if (body.length > MAX_BODY) throw new PostError("That is longer than the box allows.");

  const parentId = input.parentId ?? null;
  if (parentId) {
    const parent = await db.get<{ parent_id: string | null }>(
      `SELECT parent_id FROM playground_posts WHERE id = ?`,
      [parentId],
    );
    if (!parent) throw new PostError("That conversation is gone.");
    // One level deep. A reply to a reply reads as a reply to the topic, which
    // keeps the thread legible on a phone instead of stepping off the screen.
    if (parent.parent_id) throw new PostError("Reply to the topic instead.");
  }

  const id = randomUUID();
  await db.run(
    `INSERT INTO playground_posts
       (id, parent_id, user_id, author, symbol, horizon, body, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      parentId,
      input.userId,
      input.author,
      // A reply inherits the topic's subject; only a new topic names one.
      parentId ? null : (input.symbol?.trim().toUpperCase() || null),
      parentId ? null : (input.horizon ?? null),
      body,
      now.toISOString(),
    ],
  );

  return {
    id,
    userId: input.userId,
    author: input.author,
    symbol: parentId ? null : (input.symbol?.trim().toUpperCase() || null),
    horizon: parentId ? null : (input.horizon ?? null),
    body,
    createdAt: now.toISOString(),
    replies: [],
  };
}

/**
 * Removes your own post, or anybody's if you run the place.
 *
 * Replies go with the topic through the foreign key, so deleting a topic does
 * not leave answers to a question nobody can read.
 */
export async function removePost(
  db: DB,
  input: { id: string; userId: string; isAdministrator: boolean },
): Promise<boolean> {
  const result = input.isAdministrator
    ? await db.run(`DELETE FROM playground_posts WHERE id = ?`, [input.id])
    : await db.run(`DELETE FROM playground_posts WHERE id = ? AND user_id = ?`, [
        input.id,
        input.userId,
      ]);
  return result.changes > 0;
}

/** Every ticker anybody has named, for pricing the room in one request. */
export function symbolsIn(threads: Post[]): string[] {
  return [...new Set(threads.flatMap((t) => (t.symbol ? [t.symbol] : [])))];
}
