/**
 * Rebuilds daily valuations from the first trade to today.
 *
 *   npx tsx scripts/reconstruct-history.ts [--write]
 *
 * Without --write it reports what it would record and how closely the final
 * day matches the live account, which is the only check that matters: if the
 * replay lands on today's real value, the days before it are trustworthy too.
 *
 * Rows are marked `reconstructed` so a chart can distinguish them from days
 * captured at the time.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { closeDb, getDb } from "../src/lib/db";
import { reconstruct, type CashFlow, type PriceSeries } from "../src/lib/portfolio/reconstruct";
import { writeSnapshot } from "../src/lib/portfolio/snapshots";
import { readTransactions } from "../src/lib/portfolio/transactions";
import { getMarketDataProvider } from "../src/providers";
import { parseSymbol } from "../src/lib/moomoo/symbols";

/** Matches the replay's own rule, so the two cannot drift apart. */
function multiplierFor(symbol: string): number {
  return parseSymbol(symbol).instrumentType === "option" ? 100 : 1;
}

const usd = (value: { toFixed(dp: number): string }) => ({
  amount: value.toFixed(2),
  currency: "USD",
});

async function main() {
  const write = process.argv.includes("--write");
  const db = await getDb();

  const fills = (await readTransactions(db, 5000)).slice().reverse();
  if (fills.length === 0) throw new Error("No fills on record — nothing to replay.");

  const deposits = (
    await db.all<{ date: string; amount: number }>(
      "SELECT date, amount FROM analysis_flows ORDER BY date",
    )
  ).map((row): CashFlow => ({ date: row.date, amount: Number(row.amount) }));
  if (deposits.length === 0) {
    throw new Error(
      "No cash flows recorded. Run db:import-deposits first — without dates a " +
        "deposit cannot be told apart from a gain.",
    );
  }

  // The broker records the cash each fill actually moved. Recomputing it from
  // quantity x price x multiplier and comparing is what would have caught the
  // option multiplier being wrong for every contract: the replay agreed with
  // itself and with the account total, because understating a purchase and
  // understating the resulting holding cancel out. Only the broker's own
  // amount is independent of that mistake.
  const mismatched = fills.filter((fill) => {
    const expected = fill.quantity * fill.price * multiplierFor(fill.symbol);
    const actual = Math.abs(fill.amount);
    if (!Number.isFinite(actual) || actual === 0) return false;
    return Math.abs(expected - actual) > Math.max(1, actual * 0.01);
  });
  if (mismatched.length > 0) {
    console.error(
      `\n${mismatched.length} fill(s) disagree with the cash the broker says they moved:`,
    );
    for (const fill of mismatched.slice(0, 10)) {
      const expected = fill.quantity * fill.price * multiplierFor(fill.symbol);
      console.error(
        `  ${fill.tradedAt.slice(0, 10)}  ${fill.symbol.padEnd(20)}` +
          `  computed ${expected.toFixed(2).padStart(11)}` +
          `  recorded ${Math.abs(fill.amount).toFixed(2).padStart(11)}`,
      );
    }
    console.error(
      "\nRe-run db:import-fills so the recorded amounts match, then try again.\n",
    );
    await closeDb();
    process.exit(1);
  }

  const from = fills[0].tradedAt.slice(0, 10);
  const to = new Date().toISOString().slice(0, 10);
  const symbols = [...new Set(fills.map((f) => f.symbol))];
  console.log(`\nReplaying ${fills.length} fills across ${symbols.length} symbols, ${from} to ${to}.`);

  // Cached on disk because the broker rate-limits: a run that fetched cleanly
  // and then wrote was silently replaced by one where two dozen symbols came
  // back empty, and every valuation after that point was wrong. The cache also
  // guarantees a dry run and the write that follows see identical data.
  const CACHE = "data/price-history.json";
  const cache: Record<string, Record<string, number>> =
    existsSync(CACHE) && !process.argv.includes("--refresh")
      ? JSON.parse(readFileSync(CACHE, "utf8"))
      : {};

  const provider = await getMarketDataProvider();
  const prices: PriceSeries = new Map();
  const tradingDays = new Set<string>();
  const missingSymbols: string[] = [];

  for (const symbol of symbols) {
    let series = cache[symbol];
    if (!series) {
      for (let attempt = 1; attempt <= 3 && !series; attempt++) {
        try {
          const history = await provider.getHistoricalPrices(symbol, { from, to });
          if (history.length > 0) {
            series = Object.fromEntries(history.map((p) => [p.date, p.close]));
            cache[symbol] = series;
          }
        } catch {
          /* retried below */
        }
        if (!series && attempt < 3) await new Promise((r) => setTimeout(r, attempt * 1500));
      }
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!series) {
      missingSymbols.push(symbol);
      continue;
    }
    prices.set(symbol, new Map(Object.entries(series)));
    for (const date of Object.keys(series)) tradingDays.add(date);
  }

  mkdirSync("data", { recursive: true });
  writeFileSync(CACHE, JSON.stringify(cache, null, 2));
  const missing = missingSymbols.length;

  // Deposits can land before the first close, and the series has to start with
  // them or the opening days show a return that never happened.
  // Deposits are carried onto the series by reconstruct(), so their own dates
  // are deliberately not added here — a weekend one would break the run.

  // Every weekday from the first deposit onward, not only the days with a
  // close. Two kinds of hole would otherwise appear: the fortnight the money
  // sat as cash before the first trade, and every market holiday. The daily
  // statistics refuse to run across a gap, so drawdown, volatility and
  // best/worst day all came back blank because of four public holidays.
  //
  // Carrying the last close through a closed day is not an approximation —
  // nothing traded, so the value genuinely did not move.
  const start = [...tradingDays].sort()[0];
  const cursor = new Date(`${start}T00:00:00Z`);
  const stop = new Date(`${to}T00:00:00Z`);
  while (cursor <= stop) {
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) tradingDays.add(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const dates = [...tradingDays].sort();

  const days = reconstruct(fills, deposits, prices, dates);
  const last = days[days.length - 1];

  // Like for like: the replay's value includes cash, so the live figure must
  // too — positions carry a reported market value, cash carries a quantity.
  const live = await db.get<{ positions: string; cash: string }>(
    `SELECT COALESCE(SUM(CASE WHEN instrument_type <> 'cash'
                              THEN COALESCE(reported_market_value, 0) ELSE 0 END), 0)::text AS positions,
            COALESCE(SUM(CASE WHEN instrument_type = 'cash'
                              THEN quantity ELSE 0 END), 0)::text AS cash
       FROM positions`,
  );
  const actual = Number(live?.positions ?? 0) + Number(live?.cash ?? 0);

  console.log(`\n  ${dates.length} trading days reconstructed`);
  console.log(`  final replayed value   ${last.marketValue.toFixed(2).padStart(12)}`);
  console.log(`  live account value     ${actual.toFixed(2).padStart(12)}` +
    `  (positions ${Number(live?.positions ?? 0).toFixed(2)} + cash ${Number(live?.cash ?? 0).toFixed(2)})`);
  console.log(`  replayed cash          ${last.cash.toFixed(2).padStart(12)}`);
  console.log(`  difference             ${(last.marketValue.toNumber() - actual).toFixed(2).padStart(12)}`);
  console.log(`  net deposits           ${last.netDeposits.toFixed(2).padStart(12)}`);
  console.log(`  total return           ${last.totalReturn.toFixed(2).padStart(12)}`);
  console.log(`    of which realized    ${last.realized.toFixed(2).padStart(12)}`);
  console.log(`    of which unrealized  ${last.unrealized.toFixed(2).padStart(12)}`);
  if (missing) {
    console.log(`\n  ! ${missing} symbol(s) have no price history: ${missingSymbols.join(", ")}`);
  }

  // Refuse rather than record something that cannot be told apart from real
  // history once it is in the table.
  const TOLERANCE = 250;
  const drift = Math.abs(last.marketValue.toNumber() - actual);
  const refusals = [
    missing > 0 && `${missing} symbol(s) priced from nothing — re-run with --refresh`,
    drift > TOLERANCE && `final value is ${drift.toFixed(2)} from the live account, over the ${TOLERANCE} tolerance`,
  ].filter(Boolean) as string[];

  if (write && refusals.length > 0) {
    console.error("\nRefusing to write:");
    for (const reason of refusals) console.error(`  - ${reason}`);
    console.error("");
    await closeDb();
    process.exit(1);
  }

  if (!write) {
    console.log("\nDry run. Pass --write to record these days.\n");
    await closeDb();
    return;
  }

  let written = 0;
  for (const day of days) {
    await writeSnapshot(
      db,
      day.date,
      {
        totalMarketValue: usd(day.marketValue),
        totalCostBasis: usd(day.costBasis.plus(day.cash)),
        totalUnrealizedPnL: usd(day.unrealized),
        cashValue: usd(day.cash),
        realizedPnL: usd(day.realized),
        netDeposits: usd(day.netDeposits),
      },
      "[]",
      new Date(),
      "reconstructed",
    );
    written += 1;
  }

  console.log(`\nRecorded ${written} reconstructed days.\n`);
  await closeDb();
}

main().catch((error) => {
  console.error("\nReconstruction failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
