import "server-only";
import type { DB } from "@/lib/db";
import { logger } from "@/lib/logger";
import { marketDateString } from "@/lib/market-hours";
import { listPortfolios } from "@/lib/portfolios";
import { rebuildPortfolio, type RebuildResult } from "./rebuild-accounts";

/** How far back a missed day is still looked for. */
const LOOKBACK_DAYS = 45;

/**
 * Weekdays with no snapshot, from the account's first day to yesterday.
 *
 * "First day" is the earliest snapshot, or for a practice account the day it
 * was opened — one that has never been captured still has days to fill.
 * Today is left to the evening capture.
 */
export function missingWeekdays(
  recorded: string[],
  today: string,
  options: { since?: string; lookbackDays?: number } = {},
): string[] {
  const have = new Set(recorded);
  const starts = [...recorded, ...(options.since ? [options.since] : [])].sort();
  if (starts.length === 0) return [];

  const floor = new Date(`${today}T12:00:00Z`);
  floor.setUTCDate(floor.getUTCDate() - (options.lookbackDays ?? LOOKBACK_DAYS));
  const start = starts[0] > floor.toISOString().slice(0, 10) ? starts[0] : floor.toISOString().slice(0, 10);

  const missing: string[] = [];
  for (const cursor = new Date(`${start}T12:00:00Z`); ; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const date = cursor.toISOString().slice(0, 10);
    if (date >= today) break;
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6 && !have.has(date)) missing.push(date);
  }
  return missing;
}

type GapState = { date: string; tried: string[] };

/**
 * Filling in the days the evening capture missed, without being asked.
 *
 * The capture was broken from 21 September to 27 September, and the only way
 * back was an owner pressing "Rebuild history" — which nobody would know to
 * do, and which rewrote every account's whole history to fill four days.
 * This runs after each evening's capture is complete, finds weekdays with no
 * snapshot, and re-derives only those, one account at a time so a slow one
 * cannot run the scheduler out of time. Each account is tried once a day: one
 * that cannot be rebuilt is logged with its reason and left until tomorrow.
 */
export async function fillHistoryGaps(
  db: DB,
  now: Date,
  budgetMs = 20_000,
): Promise<{ slug: string; missing: string[]; result: RebuildResult }[]> {
  const started = Date.now();
  const today = marketDateString(now);
  const state = await readState(db);
  const tried = new Set(state?.date === today ? state.tried : []);
  const filled: { slug: string; missing: string[]; result: RebuildResult }[] = [];

  for (const portfolio of await listPortfolios(db)) {
    if (tried.has(portfolio.slug)) continue;
    if (Date.now() - started > budgetMs) break;

    const rows = await db.all<{ snapshot_date: string }>(
      `SELECT snapshot_date FROM portfolio_snapshots WHERE portfolio_id = ?`,
      [portfolio.id],
    );
    const missing = missingWeekdays(
      rows.map((row) => row.snapshot_date),
      today,
      portfolio.kind === "mock" ? { since: marketDateString(new Date(portfolio.createdAt)) } : {},
    );

    tried.add(portfolio.slug);
    await writeState(db, { date: today, tried: [...tried] }, now);
    if (missing.length === 0) continue;

    const result = await rebuildPortfolio(db, portfolio, { only: new Set(missing) });
    logger.info("portfolio.gapfill", {
      portfolio: portfolio.slug,
      missing: missing.length,
      written: result.written,
      refused: result.refusals.join("; "),
    });
    filled.push({ slug: portfolio.slug, missing, result });
  }

  return filled;
}

async function readState(db: DB): Promise<GapState | null> {
  const row = await db.get<{ payload: string }>(
    `SELECT payload FROM series_cache WHERE key = 'cron:gapfill'`,
  );
  try {
    return row ? (JSON.parse(row.payload) as GapState) : null;
  } catch {
    return null;
  }
}

async function writeState(db: DB, state: GapState, now: Date): Promise<void> {
  await db.run(
    `INSERT INTO series_cache (key, payload, fetched_at) VALUES ('cron:gapfill', ?, ?)
     ON CONFLICT(key) DO UPDATE SET payload = excluded.payload, fetched_at = excluded.fetched_at`,
    [JSON.stringify(state), now.toISOString()],
  );
}
