import type { DB } from "@/lib/db";
import type { BrokerTransaction } from "@/types/broker";
import type { BrokerProvider } from "@/providers/broker/types";

export type StoredTransaction = BrokerTransaction & { syncedAt: string };

type Row = {
  deal_id: string;
  order_id: string | null;
  side: string;
  symbol: string;
  name: string | null;
  quantity: number;
  price: number;
  amount: number;
  traded_at: string;
  synced_at: string;
};

function toTransaction(row: Row): StoredTransaction {
  return {
    dealId: row.deal_id,
    orderId: row.order_id ?? "",
    side: row.side === "sell" ? "sell" : "buy",
    symbol: row.symbol,
    name: row.name ?? undefined,
    quantity: row.quantity,
    price: row.price,
    amount: row.amount,
    tradedAt: row.traded_at,
    syncedAt: row.synced_at,
  };
}

export async function readTransactions(
  db: DB,
  limit = 500,
): Promise<StoredTransaction[]> {
  const rows = await db.all<Row>(
    `SELECT * FROM transactions ORDER BY traded_at DESC LIMIT ?`,
    [limit],
  );
  return rows.map(toTransaction);
}

export async function lastTransactionSync(db: DB): Promise<string | null> {
  const row = await db.get<{ synced_at: string | null }>(
    `SELECT MAX(synced_at) AS synced_at FROM transactions`,
  );
  return row?.synced_at ?? null;
}

/**
 * Upserts by deal id, so re-syncing an overlapping window neither duplicates a
 * fill nor drops history that has aged out of the broker's 90-day response.
 */
export async function syncTransactions(
  db: DB,
  broker: BrokerProvider,
  now: Date = new Date(),
): Promise<number> {
  const fills = await broker.getTransactions();
  const syncedAt = now.toISOString();

  const upsert = `INSERT INTO transactions
       (deal_id, order_id, side, symbol, name, quantity, price, amount, traded_at, synced_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(deal_id) DO UPDATE SET
       side = excluded.side,
       symbol = excluded.symbol,
       name = excluded.name,
       quantity = excluded.quantity,
       price = excluded.price,
       amount = excluded.amount,
       traded_at = excluded.traded_at,
       synced_at = excluded.synced_at`;

  await db.transaction(async (tx) => {
    for (const fill of fills) {
      await tx.run(upsert, [
        fill.dealId,
        fill.orderId,
        fill.side,
        fill.symbol,
        fill.name ?? null,
        fill.quantity,
        fill.price,
        fill.amount,
        fill.tradedAt,
        syncedAt,
      ]);
    }
  });

  return fills.length;
}

export type TransactionTotals = {
  trades: number;
  bought: number;
  sold: number;
  netCashFlow: number;
};

export function transactionTotals(items: StoredTransaction[]): TransactionTotals {
  let bought = 0;
  let sold = 0;

  for (const item of items) {
    if (item.side === "buy") bought += Math.abs(item.amount);
    else sold += Math.abs(item.amount);
  }

  return { trades: items.length, bought, sold, netCashFlow: sold - bought };
}
