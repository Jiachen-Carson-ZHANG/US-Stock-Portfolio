import "server-only";
import { randomUUID } from "node:crypto";
import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";
import { currentSpan, type Span } from "./span";

export { timed } from "./span";

/**
 * Where the time goes.
 *
 * "The site feels slow" cannot be argued with or fixed. "The performance page
 * spends 4.2 of its 4.8 seconds waiting on the broker" can be both. This
 * records a duration for every page render and API call, with a breakdown of
 * how much of it was the database and how much was somebody else's server.
 *
 * Deliberately narrow about what it stores: a path, a duration, a breakdown
 * and an outcome. No request bodies, no query strings, no headers. An
 * administrator reading these logs should learn how fast the site is, never
 * what anybody typed into it.
 */

export type Timing = {
  id: string;
  path: string;
  username: string | null;
  ms: number;
  dbMs: number | null;
  brokerMs: number | null;
  outcome: string;
  detail: string | null;
  createdAt: string;
};

type Row = {
  id: string;
  path: string;
  username: string | null;
  ms: number;
  db_ms: number | null;
  broker_ms: number | null;
  outcome: string;
  detail: string | null;
  created_at: string;
};

const toTiming = (row: Row): Timing => ({
  id: row.id,
  path: row.path,
  username: row.username,
  ms: Number(row.ms),
  dbMs: row.db_ms === null ? null : Number(row.db_ms),
  brokerMs: row.broker_ms === null ? null : Number(row.broker_ms),
  outcome: row.outcome,
  detail: row.detail,
  createdAt: row.created_at,
});

/**
 * Runs something and records how long it took.
 *
 * The recording is fire-and-forget on purpose. A logging table that is slow,
 * full or missing must never be the reason a page fails to render — the whole
 * point of this is to make things faster, and a measurement that costs a
 * round trip in the request it is measuring would be self-defeating.
 */
export async function observe<T>(
  label: string,
  who: { id?: string | null; username?: string | null } | null,
  work: () => Promise<T>,
): Promise<T> {
  const span: Span = { db: 0, broker: 0 };
  const started = Date.now();

  try {
    const result = await currentSpan.run(span, work);
    void record(label, who, Date.now() - started, span, "ok", null);
    return result;
  } catch (error) {
    void record(
      label,
      who,
      Date.now() - started,
      span,
      "error",
      error instanceof Error ? error.message.slice(0, 300) : "unknown",
    );
    throw error;
  }
}

async function record(
  path: string,
  who: { id?: string | null; username?: string | null } | null,
  ms: number,
  span: Span,
  outcome: string,
  detail: string | null,
): Promise<void> {
  // Not worth a row. A page that rendered in 40ms is not a problem anybody is
  // looking for, and keeping every one of them would bury the ones that are.
  if (outcome === "ok" && ms < SLOW_ENOUGH_MS) return;

  try {
    const db = await getDb();
    await db.run(
      `INSERT INTO request_timings
         (id, path, user_id, username, ms, db_ms, broker_ms, outcome, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        randomUUID(),
        path,
        who?.id ?? null,
        who?.username ?? null,
        Math.round(ms),
        Math.round(span.db),
        Math.round(span.broker),
        outcome,
        detail,
        new Date().toISOString(),
      ],
    );
  } catch (error) {
    logger.warn("observe.write_failed", {
      reason: error instanceof Error ? error.message : "unknown",
    });
  }
}

/**
 * Records something that went wrong without wrapping a call around it.
 *
 * For failures that are handled rather than thrown — a price feed that did
 * not answer, where the page carries on with the last known prices. Nothing
 * upstream sees an error, so nothing upstream would record one, and the
 * symptom people report ("it says unavailable") would have no trace at all.
 */
export async function recordFailure(path: string, detail: string): Promise<void> {
  await record(path, null, 0, { db: 0, broker: 0 }, "error", detail.slice(0, 300));
}

/** Below this, a request is simply fine and not worth a row. */
export const SLOW_ENOUGH_MS = 400;

export async function recentTimings(limit = 100): Promise<Timing[]> {
  const db = await getDb();
  const rows = await db.all<Row>(
    `SELECT id, path, username, ms, db_ms, broker_ms, outcome, detail, created_at
       FROM request_timings ORDER BY created_at DESC LIMIT ?`,
    [limit],
  );
  return rows.map(toTiming);
}

export type PathSummary = {
  path: string;
  samples: number;
  medianMs: number;
  worstMs: number;
  medianDbMs: number;
  medianBrokerMs: number;
  errors: number;
};

/**
 * The slow pages, worst first, with the median rather than the mean.
 *
 * One cold start of nine seconds drags an average somewhere no request
 * actually was. The median says what a page usually does, and the worst
 * column beside it says how bad it gets.
 */
export async function slowestPaths(sinceHours = 24): Promise<PathSummary[]> {
  const db = await getDb();
  const since = new Date(Date.now() - sinceHours * 3_600_000).toISOString();

  const rows = await db.all<{
    path: string;
    samples: number;
    median_ms: number;
    worst_ms: number;
    median_db: number | null;
    median_broker: number | null;
    errors: number;
  }>(
    `SELECT path,
            COUNT(*)::int AS samples,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ms)::int AS median_ms,
            MAX(ms)::int AS worst_ms,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY COALESCE(db_ms, 0))::int AS median_db,
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY COALESCE(broker_ms, 0))::int AS median_broker,
            COUNT(*) FILTER (WHERE outcome <> 'ok')::int AS errors
       FROM request_timings
      WHERE created_at >= ?
        AND path NOT LIKE 'client %'
        AND path NOT LIKE 'server %'
        AND path NOT LIKE 'render %'
      GROUP BY path
      ORDER BY median_ms DESC
      LIMIT 40`,
    [since],
  );

  return rows.map((row) => ({
    path: row.path,
    samples: row.samples,
    medianMs: row.median_ms,
    worstMs: row.worst_ms,
    medianDbMs: row.median_db ?? 0,
    medianBrokerMs: row.median_broker ?? 0,
    errors: row.errors,
  }));
}

/**
 * Old rows removed on the way in rather than by a job nobody remembers to
 * set up. A week is long enough to see a pattern and short enough that the
 * table never becomes a thing to worry about.
 */
export async function pruneTimings(days = 7): Promise<number> {
  const db = await getDb();
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
  const result = await db.run(`DELETE FROM request_timings WHERE created_at < ?`, [cutoff]);
  return result.changes;
}

export type ErrorGroup = {
  source: "browser" | "server" | "page" | "operation";
  path: string;
  count: number;
  latestAt: string;
  latestDetail: string | null;
};

/**
 * Every failure in a window, grouped by where it happened.
 *
 * Four sources, because they point at different fixes: a browser error is
 * usually a tab running old code or a phone quirk; a server error is a handled
 * failure the code logged; a page error is a render that threw; an operation
 * is a timed loader that failed. Seeing which source is growing says where to
 * look before reading a single message.
 */
export async function recentErrors(sinceHours = 24): Promise<ErrorGroup[]> {
  const db = await getDb();
  const since = new Date(Date.now() - sinceHours * 3_600_000).toISOString();

  const rows = await db.all<{
    path: string;
    n: number;
    latest_at: string;
    latest_detail: string | null;
  }>(
    `SELECT path,
            COUNT(*)::int AS n,
            MAX(created_at) AS latest_at,
            (ARRAY_AGG(detail ORDER BY created_at DESC))[1] AS latest_detail
       FROM request_timings
      WHERE created_at >= ? AND outcome <> 'ok'
      GROUP BY path
      ORDER BY MAX(created_at) DESC
      LIMIT 60`,
    [since],
  );

  return rows.map((row) => ({
    source: row.path.startsWith("client ")
      ? "browser"
      : row.path.startsWith("server ")
        ? "server"
        : row.path.startsWith("render ")
          ? "page"
          : "operation",
    path: row.path.replace(/^(client|server|render) /, ""),
    count: row.n,
    latestAt: row.latest_at,
    latestDetail: row.latest_detail,
  }));
}
