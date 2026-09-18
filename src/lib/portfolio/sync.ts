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

export function lastSyncedAt(db: DB): string | null {
  const row = db
    .prepare(`SELECT MAX(synced_at) AS synced_at FROM positions`)
    .get() as { synced_at: string | null };
  return row?.synced_at ?? null;
}

export function storedBrokers(db: DB): string[] {
  const rows = db
    .prepare(`SELECT DISTINCT broker FROM positions`)
    .all() as { broker: string }[];
  return rows.map((row) => row.broker);
}

export function readPositions(db: DB): Position[] {
  const rows = db.prepare(`SELECT * FROM positions`).all() as PositionRow[];
  return rows.map(toPosition);
}

/**
 * Replaces the stored position set with the broker's current view in one
 * transaction, so a mid-sync failure cannot leave a half-written portfolio.
 */
export async function syncPositions(
  db: DB,
  broker: BrokerProvider,
  brokerName: Position["broker"],
  now: Date = new Date(),
): Promise<number> {
  const positions = await broker.getPositions();
  const syncedAt = now.toISOString();

  const insert = db.prepare(
    `INSERT INTO positions
       (id, broker, instrument_type, symbol, underlying_symbol, name, sector,
        quantity, average_cost, currency, option_type, strike, expiration_date,
        contract_multiplier, reported_price, reported_market_value, reported_unrealized_pnl,
        reported_today_pnl, reported_realized_pnl, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const replaceAll = db.transaction(() => {
    db.prepare(`DELETE FROM positions`).run();
    for (const position of positions) {
      insert.run(
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
      );
    }
  });

  replaceAll();
  return positions.length;
}
