/**
 * One-time copy of the SQLite database into Postgres.
 *
 *   npx tsx scripts/sqlite-to-postgres.ts [path/to/portfolio.db]
 *
 * Reads nothing it does not need and writes with ON CONFLICT DO NOTHING, so it
 * is safe to run twice. Existing Postgres rows always win — the script only
 * fills gaps, it never overwrites.
 *
 * Snapshot history is the reason this exists: accounts re-seed and the broker
 * can be reconnected, but a daily portfolio-value series cannot be recreated
 * once it is gone.
 */
import Database from "better-sqlite3";
import { closeDb, getDb } from "../src/lib/db";

// Parents before children: sessions reference users.
// login_attempts is deliberately absent — it is 15-minute rate-limit state with
// no primary key, so copying it cannot be made idempotent and stale rows would
// only make someone likelier to be locked out.
const TABLES = [
  "users",
  "sessions",
  "activity_events",
  "broker_connections",
  "positions",
  "transactions",
  "watchlist",
  "quote_cache",
  "portfolio_snapshots",
] as const;

async function main() {
  const path = process.argv[2] ?? "./data/portfolio.db";
  console.log(`\nReading SQLite  : ${path}`);

  const sqlite = new Database(path, { readonly: true });
  const pg = await getDb();
  console.log("Writing Postgres: DATABASE_URL\n");

  let copied = 0;
  let skipped = 0;

  for (const table of TABLES) {
    const exists = sqlite
      .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name=?`)
      .get(table);
    if (!exists) {
      console.log(`  ${table.padEnd(20)} not present in source`);
      continue;
    }

    const rows = sqlite.prepare(`SELECT * FROM ${table}`).all() as Record<
      string,
      unknown
    >[];
    if (rows.length === 0) {
      console.log(`  ${table.padEnd(20)} empty`);
      continue;
    }

    const columns = Object.keys(rows[0]);
    const placeholders = columns.map(() => "?").join(", ");
    const conflict = " ON CONFLICT DO NOTHING";
    const sql =
      `INSERT INTO ${table} (${columns.join(", ")}) ` +
      `VALUES (${placeholders})${conflict}`;

    let inserted = 0;
    await pg.transaction(async (tx) => {
      for (const row of rows) {
        const result = await tx.run(
          sql,
          columns.map((c) => row[c]),
        );
        inserted += result.changes;
      }
    });

    copied += inserted;
    skipped += rows.length - inserted;
    const note = rows.length === inserted ? "" : ` (${rows.length - inserted} already present)`;
    console.log(`  ${table.padEnd(20)} ${inserted} of ${rows.length} rows${note}`);
  }

  sqlite.close();
  await closeDb();

  console.log(`\nCopied ${copied} rows, skipped ${skipped} already present.\n`);
}

main().catch((error) => {
  console.error("\nMigration failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
