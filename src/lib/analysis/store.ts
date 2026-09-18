import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { DB } from "@/lib/db";
import type { CashFlow, Coverage, Observation } from "./math";

const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "Invalid date");
const rows = z
  .array(z.object({ date, value: z.number().finite().positive().max(1e12) }))
  .min(2)
  .max(2000)
  .refine(
    (v) => new Set(v.map((r) => r.date)).size === v.length,
    "Duplicate date",
  );
export const analysisInputSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("flow"),
    date,
    amount: z
      .number()
      .finite()
      .min(-1e12)
      .max(1e12)
      .refine((v) => v !== 0),
    note: z.string().trim().max(200).default(""),
  }),
  z.object({ action: z.literal("removeFlow"), id: z.string().uuid() }),
  z.object({ action: z.literal("review"), from: date, to: date }),
  z.object({
    action: z.literal("observations"),
    kind: z.enum(["benchmark", "fx"]),
    source: z.string().trim().min(3).max(180),
    rows,
  }),
]);
export type AnalysisData = {
  flows: CashFlow[];
  coverage: Coverage | null;
  benchmark: Observation[];
  fx: Observation[];
  sources: { benchmark: string; fx: string };
};
// The tables live in the central schema (src/lib/db/index.ts), applied once at
// startup under an advisory lock, rather than being re-created on every read.

export async function readAnalysis(db: DB): Promise<AnalysisData> {
  const [configRows, flows, benchmark, fx] = await Promise.all([
    db.all<{ key: string; value: string }>("SELECT key,value FROM analysis_config"),
    db.all<CashFlow>("SELECT id,date,amount,note FROM analysis_flows ORDER BY date,id"),
    db.all<Observation>(
      "SELECT date,value FROM analysis_observations WHERE kind=? ORDER BY date",
      ["benchmark"],
    ),
    db.all<Observation>(
      "SELECT date,value FROM analysis_observations WHERE kind=? ORDER BY date",
      ["fx"],
    ),
  ]);
  const config = Object.fromEntries(configRows.map((r) => [r.key, r.value]));
  return {
    flows,
    coverage: config.review ? JSON.parse(config.review) : null,
    benchmark,
    fx,
    sources: { benchmark: config.benchmark ?? "", fx: config.fx ?? "" },
  };
}

export async function saveAnalysis(
  db: DB,
  input: z.infer<typeof analysisInputSchema>,
  userId: string,
): Promise<AnalysisData> {
  await db.transaction(async (tx) => {
    const config = (key: string, value: string) =>
      tx.run(
        "INSERT INTO analysis_config(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        [key, value],
      );
    switch (input.action) {
      case "flow":
        await tx.run(
          "INSERT INTO analysis_flows (id,date,amount,note,created_by) VALUES(?,?,?,?,?)",
          [randomUUID(), input.date, input.amount, input.note, userId],
        );
        // A new flow invalidates the reviewed window: the ledger it was signed
        // off against no longer matches.
        await tx.run("DELETE FROM analysis_config WHERE key='review'");
        break;
      case "removeFlow":
        await tx.run("DELETE FROM analysis_flows WHERE id=?", [input.id]);
        await tx.run("DELETE FROM analysis_config WHERE key='review'");
        break;
      case "review":
        if (
          input.from > input.to ||
          input.to > new Date().toISOString().slice(0, 10)
        )
          throw new Error(
            "Review dates must be ordered and cannot extend into the future.",
          );
        await config("review", JSON.stringify({ from: input.from, to: input.to }));
        break;
      case "observations":
        await tx.run("DELETE FROM analysis_observations WHERE kind=?", [input.kind]);
        for (const row of input.rows)
          await tx.run(
            "INSERT INTO analysis_observations (kind,date,value) VALUES(?,?,?)",
            [input.kind, row.date, row.value],
          );
        await config(input.kind, input.source);
        break;
    }
  });
  return readAnalysis(db);
}
