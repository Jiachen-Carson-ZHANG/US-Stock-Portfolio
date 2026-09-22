import type { DB } from "@/lib/db";
import { realizedBySymbol } from "./reconstruct";
import { readTransactions } from "./transactions";

type Entry = { key: string; value: Record<string, number> };

/**
 * Realized profit per symbol, recomputed only when the trades change.
 *
 * Deriving it means reading every fill and replaying the account, which is
 * work proportional to the whole trading history — and it was happening on
 * every dashboard load, for every viewer. The answer cannot change unless a
 * fill is added or edited, so it is computed once and kept.
 *
 * The key is a fingerprint of the fill list: how many there are, and the
 * newest traded and synced timestamps. That makes invalidation automatic
 * rather than something to remember. Placing a mock trade inserts a row, the
 * fingerprint moves, and the next read recomputes — so a position bought
 * from the dashboard shows its result immediately.
 *
 * Held per process. On serverless each instance keeps its own, which is
 * correct for a pure derivation: a cold instance simply computes it once.
 */
const cache = new Map<string, Entry>();

/** Bounded so a long-lived instance with many portfolios cannot grow forever. */
const MAX_ENTRIES = 64;

async function fingerprint(db: DB, portfolioId: string): Promise<string> {
  const row = await db.get<{ n: number; traded: string | null; synced: string | null }>(
    `SELECT COUNT(*)::int AS n,
            MAX(traded_at) AS traded,
            MAX(synced_at) AS synced
       FROM transactions WHERE portfolio_id = ?`,
    [portfolioId],
  );
  return `${row?.n ?? 0}|${row?.traded ?? ""}|${row?.synced ?? ""}`;
}

export async function realizedFor(
  db: DB,
  portfolioId: string,
): Promise<Record<string, number>> {
  const key = await fingerprint(db, portfolioId);
  const hit = cache.get(portfolioId);
  if (hit && hit.key === key) return hit.value;

  const value = Object.fromEntries(
    realizedBySymbol(await readTransactions(db, portfolioId, 5000)),
  );

  if (cache.size >= MAX_ENTRIES && !cache.has(portfolioId)) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(portfolioId, { key, value });
  return value;
}

/** For tests, and for anything that rewrites fills behind the app's back. */
export function clearRealizedCache(portfolioId?: string): void {
  if (portfolioId === undefined) cache.clear();
  else cache.delete(portfolioId);
}
