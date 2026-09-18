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
  notes: { id: string; author: string; body: string; createdAt: string }[];
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
    notes: [],
  };
}

function ensureNotes(db: DB) {
  db.exec(`CREATE TABLE IF NOT EXISTS watchlist_notes (
    id TEXT PRIMARY KEY, symbol TEXT NOT NULL REFERENCES watchlist(symbol) ON DELETE CASCADE,
    author TEXT NOT NULL, body TEXT NOT NULL, created_at TEXT NOT NULL
  )`);
}
function withNotes(db: DB, row: Row): WatchlistEntry {
  return {...toEntry(row), notes: db.prepare('SELECT id,author,body,created_at AS createdAt FROM watchlist_notes WHERE symbol=? ORDER BY created_at,id').all(row.symbol) as WatchlistEntry['notes']};
}
export function readWatchlist(db: DB): WatchlistEntry[] {
  ensureNotes(db);
  const rows = db
    .prepare(`SELECT * FROM watchlist ORDER BY created_at DESC`)
    .all() as Row[];
  return rows.map(row => withNotes(db, row));
}

export function addToWatchlist(
  db: DB,
  entry: { symbol: string; name?: string; reason: string; addedBy: string },
  now: Date = new Date(),
): WatchlistEntry {
  ensureNotes(db);
  const symbol = entry.symbol.toUpperCase();
  return db.transaction(() => {
    const original = db.prepare('SELECT * FROM watchlist WHERE symbol=?').get(symbol) as Row | undefined;
    if (original) {
      db.prepare('INSERT INTO watchlist_notes VALUES(?,?,?,?,?)').run(randomUUID(),symbol,entry.addedBy,entry.reason,now.toISOString());
    } else {
      db.prepare('INSERT INTO watchlist (id,symbol,name,reason,added_by,created_at) VALUES(?,?,?,?,?,?)').run(randomUUID(),symbol,entry.name??null,entry.reason,entry.addedBy,now.toISOString());
    }
    return withNotes(db, db.prepare('SELECT * FROM watchlist WHERE symbol=?').get(symbol) as Row);
  })();
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
