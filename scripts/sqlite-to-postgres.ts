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

// Parents before children: watchlist_notes references watchlist.
//
// Two tables are deliberately absent. login_attempts is 15-minute rate-limit
// state with no primary key, so copying it cannot be made idempotent and stale
// rows would only make someone likelier to be locked out. sessions are
// throwaway too, and carrying them is actively harmful: they reference user
// ids, so if the target database already seeded its own accounts the usernames
// collide, the original users are skipped, and the sessions then fail the
// foreign key. Everyone signs in once after the move instead.
const TABLES = [
  "users",
  "activity_events",
  "broker_connections",
  "positions",
  "transactions",
  "watchlist",
  "watchlist_notes",
  "quote_cache",
  "portfolio_snapshots",
  "family_state",
  "analysis_flows",
  "analysis_config",
  "analysis_observations",
] as const;

async function main() {
  const path = process.argv[2] ?? "./data/portfolio.db";
  console.log(`\nReading SQLite  : ${path}`);

  const sqlite = new Database(path, { readonly: true });
  const pg = await getDb();
  console.log("Writing Postgres: DATABASE_URL\n");

  // Seeding creates accounts with fresh ids. If it has already run, the usernames
  // collide and the original accounts are skipped, so the family would be left
  // signing in with the seeded passwords rather than their own. Migrating into
  // an empty database avoids the question entirely.
  const existing = await pg.get<{ n: number }>(
    "SELECT COUNT(*)::int AS n FROM users",
  );
  if ((existing?.n ?? 0) > 0) {
    console.log(
      `  ! The target already holds ${existing?.n} account(s), so accounts from\n` +
        "    the SQLite file will be skipped and their passwords will not carry\n" +
        "    over. Migrate into an empty database first if that matters.\n",
    );
  }

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
