import { randomUUID } from "node:crypto";
import type { DB } from "@/lib/db";

export type WatchlistEntry = {
  id: string;
  symbol: string;
  name: string | null;
  reason: string;
  addedBy: string;
  aiNote: string | null;
  createdAt: string;
  price?: number;
  changePercent?: number;
};

type Row = {
  id: string;
  symbol: string;
  name: string | null;
  reason: string;
  added_by: string;
  ai_note: string | null;
  created_at: string;
};

function toEntry(row: Row): WatchlistEntry {
  return {
    id: row.id,
    symbol: row.symbol,
    name: row.name,
    reason: row.reason,
    addedBy: row.added_by,
    aiNote: row.ai_note,
    createdAt: row.created_at,
  };
}

export async function readWatchlist(db: DB): Promise<WatchlistEntry[]> {
  const rows = await db.all<Row>(`SELECT * FROM watchlist ORDER BY created_at DESC`);
  return rows.map(toEntry);
}

export async function addToWatchlist(
  db: DB,
  entry: { symbol: string; name?: string; reason: string; addedBy: string },
  now: Date = new Date(),
): Promise<WatchlistEntry> {
  const id = randomUUID();
  const symbol = entry.symbol.toUpperCase();

  // RETURNING hands back the stored row from the same statement, so the insert
  // and the read can no longer disagree under a concurrent write.
  const row = await db.get<Row>(
    `INSERT INTO watchlist (id, symbol, name, reason, added_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(symbol) DO UPDATE SET
       reason = excluded.reason,
       added_by = excluded.added_by,
       name = excluded.name
     RETURNING *`,
    [id, symbol, entry.name ?? null, entry.reason, entry.addedBy, now.toISOString()],
  );

  if (!row) throw new Error(`Failed to save ${symbol} to the watchlist.`);
  return toEntry(row);
}

export async function removeFromWatchlist(db: DB, symbol: string): Promise<boolean> {
  const result = await db.run(`DELETE FROM watchlist WHERE symbol = ?`, [
    symbol.toUpperCase(),
  ]);
  return result.changes > 0;
}

export async function saveAiNote(
  db: DB,
  symbol: string,
  note: string,
): Promise<void> {
  await db.run(`UPDATE watchlist SET ai_note = ? WHERE symbol = ?`, [
    note,
    symbol.toUpperCase(),
  ]);
}
