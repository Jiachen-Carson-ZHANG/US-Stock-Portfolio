/**
 * Imports fills that moomoo's API will not return.
 *
 *   npx tsx scripts/import-fills.ts data/early-fills.csv
 *
 * The OpenAPI `fills_history` endpoint serves a fixed 90-day window. Date
 * parameters are ignored — a request for a window entirely before those 90
 * days comes back with the same recent rows — and pagination is not the limit
 * either. Anything older therefore has to come from the app's own history.
 *
 * CSV columns: date,side,symbol,quantity,price
 *   2026-06-03,buy,LITE,2,978.00
 *
 * This file is also how you correct the record. If the reconstruction says
 * the replay still holds something the account has sold, add the missing
 * sell. If it says the account holds something the replay never bought — a
 * gift, a transfer in — add it as a buy at price 0, which gives it no cost
 * and lets its whole value count as gain.
 *
 * Only filled orders belong here; cancelled and failed ones never moved cash.
 * Deal ids are derived from the row, so re-importing the same file changes
 * nothing and a corrected row replaces its original.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { closeDb, getDb } from "../src/lib/db";
import { ensureDefaultPortfolio } from "../src/lib/portfolios";
import { parseSymbol } from "../src/lib/moomoo/symbols";

type Row = {
  date: string;
  side: "buy" | "sell";
  symbol: string;
  quantity: number;
  price: number;
};

/**
 * An option symbol carries its contract size; a share does not.
 *
 * Uses the shared parser. The pattern that used to live here demanded a padded
 * eight-digit strike and therefore matched none of moomoo's real symbols, so
 * every imported option fill recorded one-hundredth of the cash it moved.
 */
function multiplierFor(symbol: string): number {
  return parseSymbol(symbol).instrumentType === "option" ? 100 : 1;
}

function parse(csv: string): Row[] {
  const rows: Row[] = [];
  for (const [index, raw] of csv.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const parts = line.split(",").map((p) => p.trim());
    if (parts[0].toLowerCase() === "date") continue; // header

    const [date, side, symbol, quantity, price] = parts;
    const where = `line ${index + 1}`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) {
      throw new Error(`${where}: date must be YYYY-MM-DD, got "${date}"`);
    }
    if (side !== "buy" && side !== "sell") {
      throw new Error(`${where}: side must be buy or sell, got "${side}"`);
    }
    const qty = Number(quantity);
    const unit = Number(price);
    if (!Number.isFinite(qty) || qty <= 0) {
      throw new Error(`${where}: quantity must be a positive number`);
    }
    // Zero is allowed, and means "this arrived without being bought".
    // A gifted or transferred-in share has no cost, so all of its value
    // shows up as gain — which is what Carson decided the NVDA share should
    // do. A negative price is still nonsense.
    if (!Number.isFinite(unit) || unit < 0) {
      throw new Error(`${where}: price must be zero or a positive number`);
    }
    rows.push({ date, side, symbol: symbol.toUpperCase(), quantity: qty, price: unit });
  }
  return rows;
}

async function main() {
  const path = process.argv[2];
  if (!path) {
    console.error("Usage: npx tsx scripts/import-fills.ts <file.csv>");
    process.exit(1);
  }

  const rows = parse(readFileSync(path, "utf8"));
  const db = await getDb();
  const portfolio = await ensureDefaultPortfolio(db);
  if (!portfolio) throw new Error("No portfolio to import into.");
  console.log(`Importing into /${portfolio.slug}.`);
  const syncedAt = new Date().toISOString();

  let written = 0;
  await db.transaction(async (tx) => {
    for (const row of rows) {
      const amount =
        row.quantity * row.price * multiplierFor(row.symbol) * (row.side === "buy" ? -1 : 1);
      // Deterministic, so the same fill imported twice is the same row.
      const dealId =
        "manual-" +
        createHash("sha256")
          .update([row.date, row.side, row.symbol, row.quantity, row.price].join("|"))
          .digest("hex")
          .slice(0, 24);

      const result = await tx.run(
        `INSERT INTO transactions
           (deal_id, order_id, side, symbol, name, quantity, price, amount, traded_at, synced_at, portfolio_id)
         VALUES (?, NULL, ?, ?, NULL, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(deal_id) DO UPDATE SET
           side = excluded.side,
           quantity = excluded.quantity,
           price = excluded.price,
           amount = excluded.amount,
           traded_at = excluded.traded_at,
           synced_at = excluded.synced_at`,
        [
          dealId,
          row.side,
          row.symbol,
          row.quantity,
          row.price,
          amount,
          `${row.date}T00:00:00.000Z`,
          syncedAt,
                  portfolio.id,
        ],
      );
      written += result.changes;
    }
  });

  const earliest = await db.get<{ traded_at: string }>(
    "SELECT MIN(traded_at) AS traded_at FROM transactions",
  );
  const total = await db.get<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM transactions",
  );

  console.log(`\nImported ${rows.length} fills (${written} rows written).`);
  console.log(`History now starts ${earliest?.traded_at?.slice(0, 10) ?? "—"}, ${total?.n ?? 0} fills total.\n`);
  await closeDb();
}

main().catch((error) => {
  console.error("\nImport failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
