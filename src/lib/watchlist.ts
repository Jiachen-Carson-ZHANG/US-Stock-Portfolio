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

export function readWatchlist(db: DB): WatchlistEntry[] {
  const rows = db
    .prepare(`SELECT * FROM watchlist ORDER BY created_at DESC`)
    .all() as Row[];
  return rows.map(toEntry);
}

export function addToWatchlist(
  db: DB,
  entry: { symbol: string; name?: string; reason: string; addedBy: string },
  now: Date = new Date(),
): WatchlistEntry {
  const id = randomUUID();

  db.prepare(
    `INSERT INTO watchlist (id, symbol, name, reason, added_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(symbol) DO UPDATE SET
       reason = excluded.reason,
       added_by = excluded.added_by,
       name = excluded.name`,
  ).run(
    id,
    entry.symbol.toUpperCase(),
    entry.name ?? null,
    entry.reason,
    entry.addedBy,
    now.toISOString(),
  );

  const row = db
    .prepare(`SELECT * FROM watchlist WHERE symbol = ?`)
    .get(entry.symbol.toUpperCase()) as Row;
  return toEntry(row);
}

export function removeFromWatchlist(db: DB, symbol: string): boolean {
  return (
    db.prepare(`DELETE FROM watchlist WHERE symbol = ?`).run(symbol.toUpperCase())
      .changes > 0
  );
}

export function saveAiNote(db: DB, symbol: string, note: string): void {
  db.prepare(`UPDATE watchlist SET ai_note = ? WHERE symbol = ?`).run(
    note,
    symbol.toUpperCase(),
  );
}
