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
function init(db: DB) {
  db.exec(`CREATE TABLE IF NOT EXISTS analysis_flows(id TEXT PRIMARY KEY,date TEXT NOT NULL,amount REAL NOT NULL,note TEXT NOT NULL,created_by TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS analysis_config(key TEXT PRIMARY KEY,value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS analysis_observations(kind TEXT NOT NULL,date TEXT NOT NULL,value REAL NOT NULL,PRIMARY KEY(kind,date));`);
}
export function readAnalysis(db: DB): AnalysisData {
  init(db);
  const config = Object.fromEntries(
    (
      db.prepare("SELECT key,value FROM analysis_config").all() as {
        key: string;
        value: string;
      }[]
    ).map((r) => [r.key, r.value]),
  );
  const observations = (kind: string) =>
    db
      .prepare(
        "SELECT date,value FROM analysis_observations WHERE kind=? ORDER BY date",
      )
      .all(kind) as Observation[];
  return {
    flows: db
      .prepare(
        "SELECT id,date,amount,note FROM analysis_flows ORDER BY date,id",
      )
      .all() as CashFlow[],
    coverage: config.review ? JSON.parse(config.review) : null,
    benchmark: observations("benchmark"),
    fx: observations("fx"),
    sources: { benchmark: config.benchmark ?? "", fx: config.fx ?? "" },
  };
}
export function saveAnalysis(
  db: DB,
  input: z.infer<typeof analysisInputSchema>,
  userId: string,
) {
  init(db);
  db.transaction(() => {
    const config = (key: string, value: string) =>
      db
        .prepare(
          "INSERT INTO analysis_config(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .run(key, value);
    switch (input.action) {
      case "flow":
        db.prepare("INSERT INTO analysis_flows VALUES(?,?,?,?,?)").run(
          randomUUID(),
          input.date,
          input.amount,
          input.note,
          userId,
        );
        db.prepare("DELETE FROM analysis_config WHERE key='review'").run();
        break;
      case "removeFlow":
        db.prepare("DELETE FROM analysis_flows WHERE id=?").run(input.id);
        db.prepare("DELETE FROM analysis_config WHERE key='review'").run();
        break;
      case "review":
        if (
          input.from > input.to ||
          input.to > new Date().toISOString().slice(0, 10)
        )
          throw new Error(
            "Review dates must be ordered and cannot extend into the future.",
          );
        config("review", JSON.stringify({ from: input.from, to: input.to }));
        break;
      case "observations":
        db.prepare("DELETE FROM analysis_observations WHERE kind=?").run(
          input.kind,
        );
        for (const row of input.rows)
          db.prepare("INSERT INTO analysis_observations VALUES(?,?,?)").run(
            input.kind,
            row.date,
            row.value,
          );
        config(input.kind, input.source);
        break;
    }
  })();
  return readAnalysis(db);
}
