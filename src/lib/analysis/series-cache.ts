import { getDb } from "@/lib/db";
import { runLater } from "@/lib/later";
import { dedupe } from "@/lib/inflight";
import { logger } from "@/lib/logger";

/**
 * Daily figures, fetched once a day instead of once a page load.
 *
 * Benchmark closes and exchange rates are published once per trading day.
 * Asking for them on every render spent four outbound calls to learn nothing
 * new, and made the performance page fail outright when one of them was slow
 * — which is what the "something did not answer in time" screen was.
 *
 * On a miss the fetch is shared, so five people opening the page together
 * make one request rather than five. On a stale hit the old value is returned
 * and a refresh runs behind it: a benchmark close from this morning is a
 * perfectly good answer while today's is on its way, and a spinner is not.
 */
export async function cachedSeries<T>(
  key: string,
  ttlMs: number,
  fetcher: () => Promise<T>,
): Promise<T> {
  const db = await getDb();

  let row: { payload: string; fetched_at: string } | undefined;
  try {
    row = await db.get(`SELECT payload, fetched_at FROM series_cache WHERE key = ?`, [key]);
  } catch {
    // A cache that cannot be read is not a reason to fail; fetch instead.
  }

  const age = row ? Date.now() - Date.parse(row.fetched_at) : Infinity;

  if (row && Number.isFinite(age) && age < ttlMs) {
    const parsed = parse<T>(row.payload);
    if (parsed !== undefined) return parsed;
  }

  const refresh = dedupe(`series:${key}`, async () => {
    const value = await fetcher();
    await write(key, value);
    return value;
  });

  // Something usable already in hand: hand it over and let the refresh land
  // for whoever asks next.
  if (row) {
    const parsed = parse<T>(row.payload);
    if (parsed !== undefined) {
      runLater(() => refresh);
      return parsed;
    }
  }

  return refresh;
}

function parse<T>(payload: string): T | undefined {
  try {
    return JSON.parse(payload) as T;
  } catch {
    return undefined;
  }
}

async function write(key: string, value: unknown): Promise<void> {
  try {
    const db = await getDb();
    await db.run(
      `INSERT INTO series_cache (key, payload, fetched_at)
       VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET payload = excluded.payload,
                                      fetched_at = excluded.fetched_at`,
      [key, JSON.stringify(value), new Date().toISOString()],
    );
  } catch (error) {
    logger.warn("series_cache.write_failed", {
      reason: error instanceof Error ? error.message : "unknown",
    });
  }
}

/** Daily data; six hours is well inside one publication cycle. */
export const DAILY_TTL_MS = 6 * 3_600_000;
