import { randomUUID } from "node:crypto";
import type { DB } from "@/lib/db";

export type WatchlistNote = {
  id: string;
  author: string;
  body: string;
  createdAt: string;
};

export type WatchlistEntry = {
  id: string;
  symbol: string;
  name: string | null;
  reason: string;
  addedBy: string;
  aiNote: string | null;
  createdAt: string;
  notes: WatchlistNote[];
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

type NoteRow = WatchlistNote & { symbol: string };

function toEntry(row: Row, notes: WatchlistNote[] = []): WatchlistEntry {
  return {
    id: row.id,
    symbol: row.symbol,
    name: row.name,
    reason: row.reason,
    addedBy: row.added_by,
    aiNote: row.ai_note,
    createdAt: row.created_at,
    notes,
  };
}

async function notesFor(db: DB, symbol: string): Promise<WatchlistNote[]> {
  return db.all<WatchlistNote>(
    `SELECT id, author, body, created_at AS "createdAt"
       FROM watchlist_notes WHERE symbol = ? ORDER BY created_at, id`,
    [symbol],
  );
}

export async function readWatchlist(db: DB): Promise<WatchlistEntry[]> {
  const rows = await db.all<Row>(`SELECT * FROM watchlist ORDER BY created_at DESC`);
  if (rows.length === 0) return [];

  // One query for every note rather than one per symbol: the list renders a
  // row per entry, so the per-row version was a query per watched name.
  const notes = await db.all<NoteRow>(
    `SELECT symbol, id, author, body, created_at AS "createdAt"
       FROM watchlist_notes ORDER BY created_at, id`,
  );
  const bySymbol = new Map<string, WatchlistNote[]>();
  for (const { symbol, ...note } of notes) {
    const existing = bySymbol.get(symbol);
    if (existing) existing.push(note);
    else bySymbol.set(symbol, [note]);
  }

  return rows.map((row) => toEntry(row, bySymbol.get(row.symbol) ?? []));
}

/**
 * Adding a symbol that is already watched appends a note rather than replacing
 * the original reason — several family members watch the same name for
 * different reasons, and overwriting would lose the earlier one.
 */
export async function addToWatchlist(
  db: DB,
  entry: { symbol: string; name?: string; reason: string; addedBy: string },
  now: Date = new Date(),
): Promise<WatchlistEntry> {
  const symbol = entry.symbol.toUpperCase();

  return db.transaction(async (tx) => {
    const existing = await tx.get<Row>(`SELECT * FROM watchlist WHERE symbol = ?`, [
      symbol,
    ]);

    if (existing) {
      await tx.run(
        `INSERT INTO watchlist_notes (id, symbol, author, body, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        [randomUUID(), symbol, entry.addedBy, entry.reason, now.toISOString()],
      );
      return toEntry(existing, await notesFor(tx, symbol));
    }

    const row = await tx.get<Row>(
      `INSERT INTO watchlist (id, symbol, name, reason, added_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?)
       RETURNING *`,
      [
        randomUUID(),
        symbol,
        entry.name ?? null,
        entry.reason,
        entry.addedBy,
        now.toISOString(),
      ],
    );
    if (!row) throw new Error(`Failed to save ${symbol} to the watchlist.`);
    return toEntry(row, []);
  });
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
