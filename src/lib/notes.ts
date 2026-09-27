import type { DB } from "@/lib/db";

export type StockNote = { date: string; body: string; updatedAt: string };

/** The longest note kept, in characters. A page of thoughts, not a book. */
export const NOTE_LIMIT = 20_000;

/**
 * Somebody's journal on one share, newest first.
 *
 * Private to its author: every query is scoped by the person asking, and
 * nothing here takes a portfolio, so sharing an account never shares notes.
 */
export async function listNotes(db: DB, userId: string, symbol: string): Promise<StockNote[]> {
  return db.all<StockNote>(
    `SELECT note_date AS date, body, updated_at AS "updatedAt"
       FROM stock_notes WHERE user_id = ? AND symbol = ?
      ORDER BY note_date DESC`,
    [userId, symbol],
  );
}

/** One day's entry, written or replaced. An empty one is removed. */
export async function saveNote(
  db: DB,
  userId: string,
  symbol: string,
  date: string,
  body: string,
  now: Date = new Date(),
): Promise<void> {
  const text = body.slice(0, NOTE_LIMIT);
  if (text.trim().length === 0) {
    await db.run(`DELETE FROM stock_notes WHERE user_id = ? AND symbol = ? AND note_date = ?`, [userId, symbol, date]);
    return;
  }
  await db.run(
    `INSERT INTO stock_notes (user_id, symbol, note_date, body, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT (user_id, symbol, note_date) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`,
    [userId, symbol, date, text, now.toISOString()],
  );
}
