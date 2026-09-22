import { randomUUID } from "node:crypto";
import type { DB } from "@/lib/db";
import { notify } from "@/lib/notifications";
import { listPortfolios } from "@/lib/portfolios";
import { rank, type Period } from "./index";

export type Trophy = {
  portfolioSlug: string;
  portfolioName: string;
  period: "week" | "month" | "year";
  periodEnd: string;
  rank: number;
  returnPercent: number;
};

type Row = {
  slug: string;
  display_name: string;
  period: Trophy["period"];
  period_end: string;
  rank: number;
  return_percent: number;
};

const AWARDED: Trophy["period"][] = ["week", "month", "year"];

/** Only the top three get a place; below that a ranking is just a list. */
const PLACES = 3;

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The last day of the most recently completed week, month or year.
 *
 * "Completed" is the point: a trophy for a period still running would change
 * hands every day it ran, which is a scoreboard, not a trophy.
 */
export function lastCompletedEnd(period: Trophy["period"], now: Date): string {
  const date = new Date(`${iso(now)}T00:00:00Z`);

  if (period === "week") {
    // ISO weeks end on Sunday; step back to the most recent one that is past.
    const daysSinceSunday = date.getUTCDay();
    date.setUTCDate(date.getUTCDate() - (daysSinceSunday === 0 ? 7 : daysSinceSunday));
    return iso(date);
  }

  if (period === "month") {
    return iso(new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 0)));
  }

  return iso(new Date(Date.UTC(date.getUTCFullYear() - 1, 11, 31)));
}

/**
 * Records placings for every period that has ended and is not yet recorded.
 *
 * Run from the daily job. Idempotent: the unique index on
 * (period, period_end, portfolio) means a second run of the same day writes
 * nothing, so a cron that fires twice cannot double-award.
 */
export async function awardCompletedPeriods(
  db: DB,
  now: Date = new Date(),
): Promise<{ awarded: number }> {
  const portfolios = await listPortfolios(db);
  if (portfolios.length < 2) return { awarded: 0 };

  let awarded = 0;

  for (const period of AWARDED) {
    const periodEnd = lastCompletedEnd(period, now);

    awarded += await db.transaction(async (tx) => {
    let count = 0;
    await tx.get("SELECT pg_advisory_xact_lock(hashtext(?))", [`arena-trophy:${period}:${periodEnd}`]);
    const already = await tx.get<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM trophies WHERE period = ? AND period_end = ?`,
      [period, periodEnd],
    );
    if ((already?.n ?? 0) > 0) return 0;

    // Ranked as at the end of that period, not as at today, so a trophy
    // reflects the race as it was actually run.
    const asAt = new Date(`${periodEnd}T23:59:59Z`);
    const start = new Date(`${periodEnd}T00:00:00Z`);
    if (period === "week") start.setUTCDate(start.getUTCDate() - 6);
    else if (period === "month") start.setUTCDate(1);
    else start.setUTCMonth(0, 1);
    const standings = (await rank(tx, portfolios, period as Period, asAt, iso(start))).filter(
      (standing) => standing.returnPercent !== null,
    );
    if (standings.length < 2) return 0;

    for (const [index, standing] of standings.slice(0, PLACES).entries()) {
      const portfolio = portfolios.find((p) => p.slug === standing.slug);
      if (!portfolio) continue;

      await tx.run(
        `INSERT INTO trophies (id, portfolio_id, period, period_end, rank, return_percent, awarded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (period, period_end, portfolio_id) DO NOTHING`,
        [
          randomUUID(),
          portfolio.id,
          period,
          periodEnd,
          index + 1,
          standing.returnPercent,
          now.toISOString(),
        ],
      );
      count += 1;

      if (index === 0 && portfolio.ownerUserId) {
        await notify(
          tx,
          {
            userId: portfolio.ownerUserId,
            kind: "trophy",
            title: `You won the ${period} ending ${periodEnd}`,
            body: `${standing.returnPercent!.toFixed(2)}% — first place.`,
            link: "/arena",
          },
          now,
        );
      }
    }
    return count;
    });
  }

  return { awarded };
}

export async function trophiesFor(
  db: DB,
  portfolioIds: string[],
  limit = 60,
): Promise<Trophy[]> {
  if (portfolioIds.length === 0) return [];

  const placeholders = portfolioIds.map(() => "?").join(", ");
  const rows = await db.all<Row>(
    `SELECT p.slug, p.display_name, t.period, t.period_end, t.rank, t.return_percent
       FROM trophies t
       JOIN portfolios p ON p.id = t.portfolio_id
      WHERE t.portfolio_id IN (${placeholders})
      ORDER BY t.period_end DESC, t.rank
      LIMIT ?`,
    [...portfolioIds, limit],
  );

  return rows.map((row) => ({
    portfolioSlug: row.slug,
    portfolioName: row.display_name,
    period: row.period,
    periodEnd: row.period_end,
    rank: row.rank,
    returnPercent: Number(row.return_percent),
  }));
}
