import { randomUUID } from "node:crypto";
import type { DB } from "@/lib/db";
import type { BrokerProvider } from "@/providers/broker/types";
import type { Position } from "@/types/portfolio";

type PositionRow = {
  id: string;
  broker: string;
  instrument_type: string;
  symbol: string;
  underlying_symbol: string | null;
  name: string | null;
  sector: string | null;
  quantity: number;
  average_cost: number | null;
  currency: string;
  option_type: string | null;
  strike: number | null;
  expiration_date: string | null;
  contract_multiplier: number | null;
  reported_price: number | null;
  reported_market_value: number | null;
  reported_unrealized_pnl: number | null;
  reported_today_pnl: number | null;
  reported_realized_pnl: number | null;
  synced_at: string;
};

function toPosition(row: PositionRow): Position {
  return {
    id: row.id,
    broker: row.broker as Position["broker"],
    instrumentType: row.instrument_type as Position["instrumentType"],
    symbol: row.symbol,
    underlyingSymbol: row.underlying_symbol ?? undefined,
    name: row.name ?? undefined,
    sector: row.sector ?? undefined,
    quantity: row.quantity,
    averageCost: row.average_cost ?? undefined,
    currency: row.currency,
    optionType: (row.option_type as Position["optionType"]) ?? undefined,
    strike: row.strike ?? undefined,
    expirationDate: row.expiration_date ?? undefined,
    contractMultiplier: row.contract_multiplier ?? undefined,
    reportedPrice: row.reported_price ?? undefined,
    reportedMarketValue: row.reported_market_value ?? undefined,
    reportedUnrealizedPnL: row.reported_unrealized_pnl ?? undefined,
    reportedTodayPnL: row.reported_today_pnl ?? undefined,
    reportedRealizedPnL: row.reported_realized_pnl ?? undefined,
    lastUpdatedAt: row.synced_at,
  };
}

export async function lastSyncedAt(
  db: DB,
  portfolioId: string,
): Promise<string | null> {
  const row = await db.get<{ synced_at: string | null }>(
    `SELECT MAX(synced_at) AS synced_at FROM positions WHERE portfolio_id = ?`,
    [portfolioId],
  );
  return row?.synced_at ?? null;
}

export async function storedBrokers(db: DB, portfolioId: string): Promise<string[]> {
  const rows = await db.all<{ broker: string }>(
    `SELECT DISTINCT broker FROM positions WHERE portfolio_id = ?`,
    [portfolioId],
  );
  return rows.map((row) => row.broker);
}

export async function readPositions(db: DB, portfolioId: string): Promise<Position[]> {
  const rows = await db.all<PositionRow>(
    `SELECT * FROM positions WHERE portfolio_id = ?`,
    [portfolioId],
  );
  return rows.map(toPosition);
}

/**
 * Replaces the stored position set with the broker's current view in one
 * transaction, so a mid-sync failure cannot leave a half-written portfolio.
 */
export async function syncPositions(
  db: DB,
  portfolioId: string,
  broker: BrokerProvider,
  brokerName: Position["broker"],
  now: Date = new Date(),
): Promise<number> {
  const positions = await broker.getPositions();
  const syncedAt = now.toISOString();

  const insert = `INSERT INTO positions
       (id, broker, instrument_type, symbol, underlying_symbol, name, sector,
        quantity, average_cost, currency, option_type, strike, expiration_date,
        contract_multiplier, reported_price, reported_market_value, reported_unrealized_pnl,
        reported_today_pnl, reported_realized_pnl, synced_at, portfolio_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

  await db.transaction(async (tx) => {
    // Serialize replacements across server instances. DELETE alone cannot see
    // another transaction's newly inserted rows, so concurrent refreshes can
    // append multiple complete sets. Lock the parent even when holdings are empty.
    await tx.get(`SELECT id FROM portfolios WHERE id = ? FOR UPDATE`, [portfolioId]);
    // Scoped: replacing "the" position set used to wipe every portfolio's.
    await tx.run(`DELETE FROM positions WHERE portfolio_id = ?`, [portfolioId]);
    for (const position of positions) {
      await tx.run(insert, [
        randomUUID(),
        brokerName,
        position.instrumentType,
        position.symbol,
        position.underlyingSymbol ?? null,
        position.name ?? null,
        position.sector ?? null,
        position.quantity,
        position.averageCost ?? null,
        position.currency,
        position.optionType ?? null,
        position.strike ?? null,
        position.expirationDate ?? null,
        position.contractMultiplier ?? null,
        position.reportedPrice ?? null,
        position.reportedMarketValue ?? null,
        position.reportedUnrealizedPnL ?? null,
        position.reportedTodayPnL ?? null,
        position.reportedRealizedPnL ?? null,
        syncedAt,
        portfolioId,
      ]);
    }
  });

  return positions.length;
}
