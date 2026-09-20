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
  realized_pnl: string | null;
  net_deposits: string | null;
  source: "live" | "reconstructed";
};

export async function readSnapshots(
  db: DB,
  limit = 400,
): Promise<PortfolioSnapshot[]> {
  const rows = await db.all<SnapshotRow>(
    `SELECT snapshot_date, total_market_value, total_cost,
            total_unrealized_pnl, cash_value, realized_pnl, net_deposits, source
       FROM portfolio_snapshots
      ORDER BY snapshot_date DESC
      LIMIT ?`,
    [limit],
  );

  return rows.reverse().map((row) => ({
    snapshotDate: row.snapshot_date,
    totalMarketValue: row.total_market_value,
    totalCost: row.total_cost,
    totalUnrealizedPnL: row.total_unrealized_pnl,
    cashValue: row.cash_value,
    realizedPnL: row.realized_pnl,
    netDeposits: row.net_deposits,
    source: row.source,
  }));
}

export async function writeSnapshot(
  db: DB,
  date: string,
  summary: Pick<
    PortfolioSummary,
    | "totalMarketValue"
    | "totalCostBasis"
    | "totalUnrealizedPnL"
    | "cashValue"
    | "realizedPnL"
    | "netDeposits"
  >,
  positionsJson: string,
  now: Date = new Date(),
  source: "live" | "reconstructed" = "live",
): Promise<void> {
  await db.run(
    `INSERT INTO portfolio_snapshots
       (id, snapshot_date, total_market_value, total_cost,
        total_unrealized_pnl, cash_value, positions_json, created_at,
        realized_pnl, net_deposits, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(snapshot_date) DO UPDATE SET
       total_market_value = excluded.total_market_value,
       total_cost = excluded.total_cost,
       total_unrealized_pnl = excluded.total_unrealized_pnl,
       cash_value = excluded.cash_value,
       positions_json = excluded.positions_json,
       realized_pnl = excluded.realized_pnl,
       net_deposits = excluded.net_deposits,
       source = excluded.source`,
    [
      randomUUID(),
      date,
      summary.totalMarketValue.amount,
      summary.totalCostBasis.amount,
      summary.totalUnrealizedPnL.amount,
      summary.cashValue.amount,
      positionsJson,
      now.toISOString(),
      summary.realizedPnL.amount,
      summary.netDeposits?.amount ?? null,
      source,
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
  if (!isAfterMarketClose(now) || summary.isStale || !summary.dataTimestamp)
    return false;
  const timestamp = new Date(summary.dataTimestamp);
  if (
    !Number.isFinite(timestamp.getTime()) ||
    timestamp > now ||
    !isAfterMarketClose(timestamp) ||
    marketDateString(timestamp) !== marketDateString(now)
  )
    return false;
  const date = marketDateString(now);
  if (await hasSnapshot(db, date)) return false;
  await writeSnapshot(db, date, summary, positionsJson, now);
  return true;
}
