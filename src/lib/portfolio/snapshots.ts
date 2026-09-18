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

export async function readSnapshots(
  db: DB,
  limit = 400,
): Promise<PortfolioSnapshot[]> {
  const rows = await db.all<SnapshotRow>(
    `SELECT snapshot_date, total_market_value, total_cost,
            total_unrealized_pnl, cash_value
       FROM portfolio_snapshots
      ORDER BY snapshot_date ASC
      LIMIT ?`,
    [limit],
  );

  return rows.map((row) => ({
    snapshotDate: row.snapshot_date,
    totalMarketValue: row.total_market_value,
    totalCost: row.total_cost,
    totalUnrealizedPnL: row.total_unrealized_pnl,
    cashValue: row.cash_value,
  }));
}

export async function writeSnapshot(
  db: DB,
  date: string,
  summary: Pick<
    PortfolioSummary,
    "totalMarketValue" | "totalCostBasis" | "totalUnrealizedPnL" | "cashValue"
  >,
  positionsJson: string,
  now: Date = new Date(),
): Promise<void> {
  await db.run(
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
    [
      randomUUID(),
      date,
      summary.totalMarketValue.amount,
      summary.totalCostBasis.amount,
      summary.totalUnrealizedPnL.amount,
      summary.cashValue.amount,
      positionsJson,
      now.toISOString(),
    ],
  );
}

export async function clearSnapshots(db: DB): Promise<number> {
  const result = await db.run(`DELETE FROM portfolio_snapshots`);
  return result.changes;
}

export async function hasSnapshot(db: DB, date: string): Promise<boolean> {
  const row = await db.get(
    `SELECT 1 FROM portfolio_snapshots WHERE snapshot_date = ?`,
    [date],
  );
  return row !== undefined;
}

/**
 * Records today's close once the regular session has ended, triggered by the
 * first authenticated dashboard request rather than a platform cron (§21).
 */
export async function maybeCreateSnapshot(
  db: DB,
  summary: PortfolioSummary,
  positionsJson: string,
  now: Date = new Date(),
): Promise<boolean> {
  if (!isAfterMarketClose(now)) return false;
  const date = marketDateString(now);
  if (await hasSnapshot(db, date)) return false;
  await writeSnapshot(db, date, summary, positionsJson, now);
  return true;
}
