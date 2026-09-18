import { randomUUID } from "node:crypto";
import type { DB } from "@/lib/db";
import type { PortfolioSnapshot, PortfolioSummary } from "@/types/portfolio";
import { isAfterMarketClose, marketDateString } from "@/lib/market-hours";

type SnapshotRow = {
  snapshot_date: string;
  total_market_value: string;
  total_cost: string;
  total_unrealized_pnl: string;
  cash_value: string;
};

export function readSnapshots(db: DB, limit = 400): PortfolioSnapshot[] {
  const rows = db
    .prepare(
      `SELECT snapshot_date, total_market_value, total_cost,
              total_unrealized_pnl, cash_value
       FROM portfolio_snapshots
       ORDER BY snapshot_date ASC
       LIMIT ?`,
    )
    .all(limit) as SnapshotRow[];

  return rows.map((row) => ({
    snapshotDate: row.snapshot_date,
    totalMarketValue: row.total_market_value,
    totalCost: row.total_cost,
    totalUnrealizedPnL: row.total_unrealized_pnl,
    cashValue: row.cash_value,
  }));
}

export function writeSnapshot(
  db: DB,
  date: string,
  summary: Pick<
    PortfolioSummary,
    "totalMarketValue" | "totalCostBasis" | "totalUnrealizedPnL" | "cashValue"
  >,
  positionsJson: string,
  now: Date = new Date(),
): void {
  db.prepare(
    `INSERT INTO portfolio_snapshots
       (id, snapshot_date, total_market_value, total_cost,
        total_unrealized_pnl, cash_value, positions_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(snapshot_date) DO UPDATE SET
       total_market_value = excluded.total_market_value,
       total_cost = excluded.total_cost,
       total_unrealized_pnl = excluded.total_unrealized_pnl,
       cash_value = excluded.cash_value,
       positions_json = excluded.positions_json`,
  ).run(
    randomUUID(),
    date,
    summary.totalMarketValue.amount,
    summary.totalCostBasis.amount,
    summary.totalUnrealizedPnL.amount,
    summary.cashValue.amount,
    positionsJson,
    now.toISOString(),
  );
}

export function clearSnapshots(db: DB): number {
  return db.prepare(`DELETE FROM portfolio_snapshots`).run().changes;
}

export function hasSnapshot(db: DB, date: string): boolean {
  const row = db
    .prepare(`SELECT 1 FROM portfolio_snapshots WHERE snapshot_date = ?`)
    .get(date);
  return row !== undefined;
}

/**
 * Records today's close once the regular session has ended, triggered by the
 * first authenticated dashboard request rather than a platform cron (§21).
 */
export function maybeCreateSnapshot(
  db: DB,
  summary: PortfolioSummary,
  positionsJson: string,
  now: Date = new Date(),
): boolean {
  if (!isAfterMarketClose(now)) return false;
  const date = marketDateString(now);
  if (hasSnapshot(db, date)) return false;
  writeSnapshot(db, date, summary, positionsJson, now);
  return true;
}
