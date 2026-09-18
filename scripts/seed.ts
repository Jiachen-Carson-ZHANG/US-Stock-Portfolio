import { randomBytes, randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import { getDb } from "../src/lib/db";
import { hashPassword } from "../src/lib/auth/password";
import { syncPositions, readPositions } from "../src/lib/portfolio/sync";
import { writeSnapshot } from "../src/lib/portfolio/snapshots";
import { MockBrokerProvider } from "../src/providers/broker/mock";
import { MockMarketDataProvider } from "../src/providers/market-data/mock";
import { contractMultiplier } from "../src/lib/portfolio";
import type { UserRole } from "../src/lib/auth/session";

type SeedAccount = {
  username: string;
  displayName: string;
  role: UserRole;
  envVar: string;
};

// Usernames are stored lowercase and matched case-insensitively at login, so
// "Father" and "father" both work.
const ACCOUNTS: SeedAccount[] = [
  { username: "owner", displayName: "Owner", role: "owner", envVar: "SEED_OWNER_PASSWORD" },
  { username: "father", displayName: "Father", role: "viewer", envVar: "SEED_FATHER_PASSWORD" },
  { username: "mother", displayName: "Mother", role: "viewer", envVar: "SEED_MOTHER_PASSWORD" },
  { username: "mile", displayName: "Mile", role: "viewer", envVar: "SEED_MILE_PASSWORD" },
];

const SNAPSHOT_DAYS = 120;

// Existing accounts are never silently rewritten, so changing a SEED_* value
// has no effect until this is passed deliberately.
const RESET_PASSWORDS = process.argv.includes("--reset-passwords");

async function seedUsers() {
  const db = getDb();
  const generated: { username: string; password: string }[] = [];

  for (const account of ACCOUNTS) {
    const existing = db
      .prepare(`SELECT id FROM users WHERE username = ?`)
      .get(account.username) as { id: string } | undefined;

    if (existing && RESET_PASSWORDS) {
      const password = process.env[account.envVar];
      if (!password) {
        console.log(`  ${account.username.padEnd(7)} skipped — ${account.envVar} is empty`);
        continue;
      }
      db.prepare(
        `UPDATE users SET password_hash = ?, display_name = ?, role = ? WHERE id = ?`,
      ).run(await hashPassword(password), account.displayName, account.role, existing.id);
      console.log(`  ${account.username.padEnd(7)} password reset`);
      continue;
    }

    if (existing) {
      console.log(`  ${account.username.padEnd(7)} already exists — left unchanged`);
      continue;
    }

    const fromEnv = process.env[account.envVar];
    const password = fromEnv && fromEnv.length > 0 ? fromEnv : randomBytes(9).toString("base64url");
    if (!fromEnv) generated.push({ username: account.username, password });

    db.prepare(
      `INSERT INTO users (id, username, display_name, password_hash, role, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      randomUUID(),
      account.username,
      account.displayName,
      await hashPassword(password),
      account.role,
      new Date().toISOString(),
    );
    console.log(`  ${account.username.padEnd(7)} created (${account.role})`);
  }

  if (generated.length > 0) {
    console.log("\n  Generated passwords — copy them now, they are not stored:\n");
    for (const entry of generated) {
      console.log(`    ${entry.username.padEnd(7)} ${entry.password}`);
    }
    console.log("\n  Set SEED_* environment variables to choose your own instead.");
  }
}

async function seedPositions() {
  const db = getDb();
  const count = await syncPositions(db, new MockBrokerProvider(), "mock");
  console.log(`  synced ${count} mock positions`);
}

/**
 * Backfills the portfolio-value series so the performance chart has history on
 * a fresh install. Mock mode only — real deployments accumulate real snapshots.
 */
async function seedSnapshots() {
  const db = getDb();
  const positions = readPositions(db);
  if (positions.length === 0) return;

  const market = new MockMarketDataProvider();
  const to = new Date();
  const from = new Date(to.getTime() - SNAPSHOT_DAYS * 86_400_000);
  const range = {
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
  };

  const series = new Map<string, Map<string, number>>();
  for (const position of positions) {
    const history = await market.getHistoricalPrices(position.symbol, range);
    series.set(position.symbol, new Map(history.map((p) => [p.date, p.close])));
  }

  const dates = [...(series.get(positions[0].symbol)?.keys() ?? [])];
  const cost = positions.reduce(
    (acc, p) =>
      acc.plus(
        new Decimal(p.quantity)
          .times(p.averageCost ?? 0)
          .times(contractMultiplier(p)),
      ),
    new Decimal(0),
  );

  let written = 0;
  for (const date of dates) {
    let total = new Decimal(0);
    let cash = new Decimal(0);

    for (const position of positions) {
      if (position.instrumentType === "cash") {
        cash = cash.plus(position.quantity);
        total = total.plus(position.quantity);
        continue;
      }
      const close = series.get(position.symbol)?.get(date);
      if (close === undefined) continue;
      total = total.plus(
        new Decimal(position.quantity).times(close).times(contractMultiplier(position)),
      );
    }

    writeSnapshot(
      db,
      date,
      {
        totalMarketValue: { amount: total.toFixed(), currency: "USD" },
        totalCostBasis: { amount: cost.toFixed(), currency: "USD" },
        totalUnrealizedPnL: { amount: total.minus(cost).toFixed(), currency: "USD" },
        cashValue: { amount: cash.toFixed(), currency: "USD" },
      },
      "[]",
    );
    written++;
  }

  console.log(`  backfilled ${written} daily snapshots`);
}

async function main() {
  console.log("\nSeeding family portfolio dashboard\n");
  console.log("Accounts:");
  await seedUsers();

  // Synthetic holdings would overwrite the real ones and pollute the snapshot
  // history, so the portfolio is only seeded while no broker is connected.
  const connected = getDb()
    .prepare(`SELECT 1 FROM broker_connections LIMIT 1`)
    .get();

  if (connected) {
    console.log("\nPortfolio: broker connected — real holdings left untouched.");
  } else {
    console.log("\nPortfolio:");
    await seedPositions();
    await seedSnapshots();
  }

  console.log("\nDone.\n");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
