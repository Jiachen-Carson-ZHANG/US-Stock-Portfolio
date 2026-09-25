import "server-only";
import type { DB } from "@/lib/db";
import { runLater } from "@/lib/later";
import { logger } from "@/lib/logger";
import { parseDirectory, type Listing } from "./search";

/**
 * Every US-listed stock and fund, by name.
 *
 * moomoo's API has no symbol lookup — its search covers news and posts — so
 * the list comes from Nasdaq's public symbol directory: two plain-text files,
 * free and keyless, republished every trading day, about thirteen thousand
 * listings between them. Fetched at most once a day and kept in the
 * database, so a search is a filter over memory rather than a trip anywhere.
 */
const KEY = "directory:us";
const MAX_AGE_MS = 24 * 3_600_000;
const SOURCES = [
  { url: "https://www.nasdaqtrader.com/dynamic/SymDir/nasdaqlisted.txt", kind: "nasdaq" as const },
  { url: "https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt", kind: "other" as const },
];

let memory: { at: number; listings: Listing[] } | null = null;

async function fetchDirectory(): Promise<Listing[]> {
  const parts = await Promise.all(
    SOURCES.map(async (source) => {
      const response = await fetch(source.url, { signal: AbortSignal.timeout(10_000) });
      if (!response.ok) throw new Error(`symbol directory ${response.status}`);
      return parseDirectory(await response.text(), source.kind);
    }),
  );
  const seen = new Set<string>();
  return parts.flat().filter((listing) => !seen.has(listing.symbol) && seen.add(listing.symbol));
}

async function refresh(db: DB): Promise<Listing[]> {
  const listings = await fetchDirectory();
  if (listings.length < 1000) throw new Error(`symbol directory looked short: ${listings.length}`);
  const now = new Date().toISOString();
  await db.run(
    `INSERT INTO series_cache (key, payload, fetched_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at`,
    [KEY, JSON.stringify(listings.map((l) => [l.symbol, l.name, l.etf ? 1 : 0])), now],
  );
  memory = { at: Date.now(), listings };
  return listings;
}

/**
 * The directory, as fresh as it can be without making anybody wait.
 *
 * In memory if this instance has it; otherwise the stored copy, refreshed
 * behind the answer once it is a day old; only with nothing stored at all
 * does a search wait for Nasdaq — and if that fails too, the answer is an
 * empty list, and the ticker typed in full still works.
 */
export async function loadDirectory(db: DB): Promise<Listing[]> {
  if (memory && Date.now() - memory.at < MAX_AGE_MS) return memory.listings;

  const row = await db.get<{ payload: string; fetched_at: string }>(
    `SELECT payload, fetched_at FROM series_cache WHERE key = ?`,
    [KEY],
  );
  if (row) {
    const listings = (JSON.parse(row.payload) as [string, string, number][]).map(
      ([symbol, name, etf]) => ({ symbol, name, etf: etf === 1 }),
    );
    const age = Date.now() - new Date(row.fetched_at).getTime();
    memory = { at: age < MAX_AGE_MS ? Date.now() - age : 0, listings };
    if (age >= MAX_AGE_MS) {
      runLater(() =>
        refresh(db).catch((error: unknown) =>
          logger.error("directory.refresh.failure", {
            reason: error instanceof Error ? error.message : "unknown",
          }),
        ),
      );
    }
    return listings;
  }

  try {
    return await refresh(db);
  } catch (error) {
    logger.error("directory.refresh.failure", {
      reason: error instanceof Error ? error.message : "unknown",
    });
    return [];
  }
}

/**
 * Chinese names, for the symbols anybody here has looked at.
 *
 * moomoo sends a simplified-Chinese name with every quote, and the quote
 * cache keeps it. That covers what the family actually trades — which is
 * what somebody typing 英伟达 is looking for — without a second directory.
 */
export async function chineseNamed(db: DB, query: string): Promise<Listing[]> {
  if (!/[^\x00-\x7F]/.test(query)) return [];
  const rows = await db.all<{ symbol: string; raw: string | null }>(
    `SELECT symbol, raw FROM quote_cache WHERE raw LIKE ? LIMIT 20`,
    [`%${query.replace(/[%_]/g, "")}%`],
  );
  return rows.flatMap((row) => {
    try {
      const name = (JSON.parse(row.raw ?? "{}") as { sc_name?: unknown }).sc_name;
      return typeof name === "string" && name.includes(query)
        ? [{ symbol: row.symbol, name, etf: false }]
        : [];
    } catch {
      return [];
    }
  });
}
