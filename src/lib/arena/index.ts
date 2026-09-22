import type { DB } from "@/lib/db";
import type { AuthUser } from "@/lib/auth/session";
import { adjustedSeries, type AdjustedPoint } from "@/lib/analysis/math";
import { readAnalysis } from "@/lib/analysis/store";
import { readSnapshots } from "@/lib/portfolio/snapshots";
import { visibleTo, type Portfolio } from "@/lib/portfolios";

export const PERIODS = ["day", "week", "month", "year", "max"] as const;
export type Period = (typeof PERIODS)[number];

const WINDOW_DAYS: Record<Period, number | null> = {
  day: 1,
  week: 7,
  month: 30,
  year: 365,
  max: null,
};

/**
 * One competitor's standing over one period.
 *
 * Note what this type cannot express: there is no field for an account
 * value, a position size, a cash balance or a profit in pounds or dollars.
 * Ranking the family against each other means each of them can see this, and
 * how much money somebody has is nobody else's business. The privacy rule is
 * enforced by the shape of the data, not by remembering not to render a
 * field.
 *
 * It is also the only fair comparison: a percentage is the one thing that
 * means the same for a $10,000 mock account and a $22,000 real one.
 */
export type Standing = {
  slug: string;
  displayName: string;
  kind: "broker" | "mock";
  /** Return over the period, in percent. Null when history is too short. */
  returnPercent: number | null;
  /** The curve, rebased to 100 at the start of the period. */
  curve: { date: string; index: number }[];
  /** Why there is no figure, when there is none. */
  unavailable: string | null;
};

export type Leaderboard = {
  period: Period;
  standings: Standing[];
};

function windowFrom(period: Period, now: Date): string | null {
  const days = WINDOW_DAYS[period];
  if (days === null) return null;
  return new Date(now.getTime() - days * 86_400_000).toISOString().slice(0, 10);
}

/**
 * Rebases a slice of the index to 100 at its own start, so every period is
 * read the same way: 103.4 means up 3.4% since the period began.
 */
function rebase(points: AdjustedPoint[]): { date: string; index: number }[] {
  const base = points[0]?.index;
  if (!base) return [];
  return points.map((point) => ({
    date: point.date,
    index: (point.index / base) * 100,
  }));
}

const REASON: Record<string, string> = {
  review: "Deposits have not been confirmed for this period",
  history: "Not enough history yet",
  flowGap: "A transfer falls outside the recorded history",
  invalid: "The recorded history does not add up",
};

async function standingFor(
  db: DB,
  portfolio: Portfolio,
  period: Period,
  now: Date,
  fromOverride?: string,
): Promise<Standing> {
  const base: Omit<Standing, "returnPercent" | "curve" | "unavailable"> = {
    slug: portfolio.slug,
    displayName: portfolio.displayName,
    kind: portfolio.kind,
  };

  const [snapshots, analysis] = await Promise.all([
    readSnapshots(db, portfolio.id),
    readAnalysis(db, portfolio.id),
  ]);

  const through = now.toISOString().slice(0, 10);
  const series = adjustedSeries(
    snapshots.filter((point) => point.snapshotDate <= through),
    analysis.flows.filter((flow) => flow.date <= through),
    analysis.coverage,
  );
  if (series.issue) {
    return {
      ...base,
      returnPercent: null,
      curve: [],
      unavailable: REASON[series.issue] ?? "No comparable history",
    };
  }

  const from = fromOverride ?? windowFrom(period, now);
  // One point before the window so the first interval is a real return
  // rather than a zero, which would flatter whoever joined most recently.
  const firstInWindow = from ? series.points.findIndex((p) => p.date >= from) : 0;
  const slice = firstInWindow < 0 ? [] : series.points.slice(Math.max(0, firstInWindow - 1));

  if (slice.length < 2) {
    return {
      ...base,
      returnPercent: null,
      curve: [],
      unavailable: "Not enough history for this period",
    };
  }

  const curve = rebase(slice);
  return {
    ...base,
    returnPercent: curve[curve.length - 1].index - 100,
    curve,
    unavailable: null,
  };
}

/**
 * The leaderboard for one period, over every portfolio the viewer may see.
 *
 * Scoped by the same access rule as everything else: a portfolio you cannot
 * open does not appear here either, so the Arena is a view over the data
 * rather than a hole in it.
 */
export async function leaderboard(
  db: DB,
  user: AuthUser,
  period: Period,
  now: Date = new Date(),
): Promise<Leaderboard> {
  return { period, standings: await rank(db, await visibleTo(db, user), period, now) };
}

/**
 * Standings for a given set of portfolios, ranked.
 *
 * Separated from the viewer-scoped leaderboard because awarding a trophy has
 * to consider everybody, not only whoever happens to be looking.
 */
/**
 * Standings change when a day is recorded or a cash flow is edited, which is
 * daily at most — not on every page view, which is what computing them here
 * used to mean. Every portfolio's whole snapshot history was read and
 * replayed five times over, once per period, for each person who opened the
 * page.
 *
 * The key is a fingerprint of everything the calculation depends on, so a new
 * snapshot or a corrected transfer invalidates it without anyone remembering
 * to. Held per process; a cold instance recomputes once.
 */
const rankCache = new Map<string, { key: string; value: Standing[] }>();
const MAX_RANK_ENTRIES = 32;

async function rankFingerprint(db: DB, now: Date): Promise<string> {
  const row = await db.get<{
    snaps: number;
    lastSnap: string | null;
    flows: number;
    lastFlow: string | null;
    config: string | null;
  }>(
    `SELECT (SELECT COUNT(*)::int FROM portfolio_snapshots) AS snaps,
            (SELECT MAX(snapshot_date) FROM portfolio_snapshots) AS "lastSnap",
            (SELECT COUNT(*)::int FROM analysis_flows) AS flows,
            (SELECT MAX(date) FROM analysis_flows) AS "lastFlow",
            (SELECT MAX(value) FROM analysis_config WHERE key = 'review') AS config`,
  );

  // The calendar day matters because a period window is measured from today:
  // yesterday's "week" is not this morning's.
  return [
    now.toISOString().slice(0, 10),
    row?.snaps ?? 0,
    row?.lastSnap ?? "",
    row?.flows ?? 0,
    row?.lastFlow ?? "",
    row?.config ?? "",
  ].join("|");
}

export async function rank(
  db: DB,
  portfolios: Portfolio[],
  period: Period,
  now: Date,
  fromOverride?: string,
): Promise<Standing[]> {
  // fromOverride changes the window, so it belongs in the key — otherwise a
  // custom range would be served yesterday's answer for the default one.
  const cacheKey = `${period}:${fromOverride ?? ""}:${portfolios
    .map((p) => p.id)
    .sort()
    .join(",")}`;
  const key = await rankFingerprint(db, now);
  const hit = rankCache.get(cacheKey);
  if (hit && hit.key === key) return hit.value;

  const standings = await Promise.all(
    portfolios.map((portfolio) => standingFor(db, portfolio, period, now, fromOverride)),
  );

  standings.sort((a, b) => {
    // Anyone without a figure sits below everyone with one, rather than
    // being ranked as if they had returned zero.
    if (a.returnPercent === null && b.returnPercent === null) {
      return a.displayName.localeCompare(b.displayName);
    }
    if (a.returnPercent === null) return 1;
    if (b.returnPercent === null) return -1;
    return b.returnPercent - a.returnPercent;
  });

  if (rankCache.size >= MAX_RANK_ENTRIES && !rankCache.has(cacheKey)) {
    const oldest = rankCache.keys().next().value;
    if (oldest !== undefined) rankCache.delete(oldest);
  }
  rankCache.set(cacheKey, { key, value: standings });

  return standings;
}

/** For tests, and after a job rewrites history behind the app's back. */
export function clearArenaCache(): void {
  rankCache.clear();
}

export async function allLeaderboards(
  db: DB,
  user: AuthUser,
  now: Date = new Date(),
): Promise<Record<Period, Leaderboard>> {
  const entries = await Promise.all(
    PERIODS.map(async (period) => [period, await leaderboard(db, user, period, now)] as const),
  );
  return Object.fromEntries(entries) as Record<Period, Leaderboard>;
}
