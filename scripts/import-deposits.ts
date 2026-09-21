/**
 * Records cash paid into the broker account, with dates.
 *
 *   npx tsx scripts/import-deposits.ts data/deposits.csv
 *
 * TOTAL_DEPOSITS gives the total, which is enough to state today's return but
 * not to draw it over time: a deposit landing mid-period looks exactly like a
 * gain unless the date is known. These rows are what let the performance
 * series neutralise them.
 *
 * CSV columns: date,amount,note   (negative amount for a withdrawal)
 */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { closeDb, getDb } from "../src/lib/db";

type Flow = { date: string; amount: number; note: string };

function parse(csv: string): Flow[] {
  const flows: Flow[] = [];
  for (const [index, raw] of csv.split(/\r?\n/).entries()) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [date, amount, ...rest] = line.split(",").map((p) => p.trim());
    if (date.toLowerCase() === "date") continue;

    const where = `line ${index + 1}`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error(`${where}: date must be YYYY-MM-DD, got "${date}"`);
    }
    const value = Number(amount);
    if (!Number.isFinite(value) || value === 0) {
      throw new Error(`${where}: amount must be a non-zero number`);
    }
    flows.push({ date, amount: value, note: rest.join(",") || "Bank transfer" });
  }
  return flows;
}

async function main() {
  const path = process.argv[2] ?? "data/deposits.csv";
  const flows = parse(readFileSync(path, "utf8"));
  const db = await getDb();

  await db.transaction(async (tx) => {
    // Replacing wholesale keeps the ledger a faithful copy of the statement
    // rather than an append-only pile that double-counts on a second run.
    await tx.run("DELETE FROM analysis_flows WHERE created_by = ?", ["import"]);
    for (const flow of flows) {
      await tx.run(
        `INSERT INTO analysis_flows (id, date, amount, note, created_by)
         VALUES (?, ?, ?, ?, 'import')`,
        [randomUUID(), flow.date, flow.amount, flow.note],
      );
    }
  });

  const total = flows.reduce((n, f) => n + f.amount, 0);
  console.log(`\nRecorded ${flows.length} cash flows, ${flows[0]?.date} to ${flows[flows.length - 1]?.date}.`);
  console.log(`Net paid in: ${total.toFixed(2)}`);

  const configured = Number(process.env.TOTAL_DEPOSITS ?? "0");
  if (configured && Math.abs(configured - total) > 0.005) {
    console.log(
      `\n  ! TOTAL_DEPOSITS is ${configured.toFixed(2)} but these rows sum to ` +
        `${total.toFixed(2)}. Every return figure is anchored on that value, so ` +
        "the two need to agree.",
    );
  } else if (configured) {
    console.log(`Agrees with TOTAL_DEPOSITS.\n`);
  }

  await closeDb();
}

main().catch((error) => {
  console.error("\nImport failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
