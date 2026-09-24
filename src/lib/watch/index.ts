import type { DB } from "@/lib/db";

/**
 * Watching a symbol.
 *
 * Personal first: your list is yours, and adding or removing a name touches
 * nobody else's. Visible second: every signed-in member can see what everybody
 * is watching, which is the point of a shared room — but only the list, never
 * a holding, a size or an order. Watching a name is saying you find it
 * interesting, which is a thing people are happy to share; owning it is not.
 */
export async function myWatchlist(db: DB, userId: string): Promise<string[]> {
  const rows = await db.all<{ symbol: string }>(
    `SELECT symbol FROM watch_items WHERE user_id = ? ORDER BY created_at DESC`,
    [userId],
  );
  return rows.map((row) => row.symbol);
}

export async function watch(
  db: DB,
  userId: string,
  symbol: string,
  now: Date = new Date(),
): Promise<boolean> {
  const result = await db.run(
    `INSERT INTO watch_items (user_id, symbol, created_at)
     VALUES (?, ?, ?) ON CONFLICT DO NOTHING`,
    [userId, symbol.toUpperCase(), now.toISOString()],
  );
  return result.changes > 0;
}

export async function unwatch(db: DB, userId: string, symbol: string): Promise<boolean> {
  const result = await db.run(
    `DELETE FROM watch_items WHERE user_id = ? AND symbol = ?`,
    [userId, symbol.toUpperCase()],
  );
  return result.changes > 0;
}

export type Watcher = {
  userId: string;
  displayName: string;
  symbols: string[];
};

/** Everybody's list, for the shared tab. Active members only. */
export async function everyoneWatching(db: DB): Promise<Watcher[]> {
  const rows = await db.all<{ user_id: string; display_name: string; symbol: string }>(
    `SELECT w.user_id, u.display_name, w.symbol
       FROM watch_items w
       JOIN users u ON u.id = w.user_id
      WHERE u.status = 'active' AND u.disabled_at IS NULL
      ORDER BY u.display_name, w.created_at DESC`,
  );

  const byUser = new Map<string, Watcher>();
  for (const row of rows) {
    const entry =
      byUser.get(row.user_id) ??
      { userId: row.user_id, displayName: row.display_name, symbols: [] };
    entry.symbols.push(row.symbol);
    byUser.set(row.user_id, entry);
  }
  return [...byUser.values()];
}

/**
 * The names most people are watching, most first.
 *
 * The single most useful line on a shared list: not who watches what, but
 * what several people have independently found interesting.
 */
export async function mostWatched(
  db: DB,
  limit = 10,
): Promise<{ symbol: string; watchers: number }[]> {
  const rows = await db.all<{ symbol: string; n: number }>(
    `SELECT w.symbol, COUNT(*)::int AS n
       FROM watch_items w
       JOIN users u ON u.id = w.user_id
      WHERE u.status = 'active' AND u.disabled_at IS NULL
      GROUP BY w.symbol
      HAVING COUNT(*) > 1
      ORDER BY n DESC, w.symbol
      LIMIT ?`,
    [limit],
  );
  return rows.map((row) => ({ symbol: row.symbol, watchers: row.n }));
}

/** Every watched symbol on the site, so the scheduler keeps them priced. */
export async function allWatchedSymbols(db: DB): Promise<string[]> {
  const rows = await db.all<{ symbol: string }>(`SELECT DISTINCT symbol FROM watch_items`);
  return rows.map((row) => row.symbol);
}
