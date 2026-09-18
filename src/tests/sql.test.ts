import { describe, expect, it } from "vitest";
import { toPositionalParams } from "@/lib/db/sql";

// Every statement in the app goes through this function. A mistake here would
// transpose parameters silently — the worst failure mode a ledger can have —
// so the edge cases are pinned down rather than assumed.
describe("placeholder conversion", () => {
  it("numbers placeholders from one, in order", () => {
    expect(toPositionalParams("INSERT INTO t (a, b, c) VALUES (?, ?, ?)")).toBe(
      "INSERT INTO t (a, b, c) VALUES ($1, $2, $3)",
    );
  });

  it("leaves a statement without placeholders untouched", () => {
    expect(toPositionalParams("SELECT * FROM positions")).toBe(
      "SELECT * FROM positions",
    );
  });

  it("keeps counting across clauses", () => {
    expect(
      toPositionalParams("UPDATE t SET a = ? WHERE b = ? AND c > ?"),
    ).toBe("UPDATE t SET a = $1 WHERE b = $2 AND c > $3");
  });

  it("does not touch a question mark inside a string literal", () => {
    expect(toPositionalParams("SELECT '?' AS q WHERE a = ?")).toBe(
      "SELECT '?' AS q WHERE a = $1",
    );
  });

  it("handles an escaped quote inside a literal", () => {
    expect(toPositionalParams("SELECT 'it''s ? here' WHERE a = ?")).toBe(
      "SELECT 'it''s ? here' WHERE a = $1",
    );
  });

  it("does not touch a question mark inside a quoted identifier", () => {
    expect(toPositionalParams('SELECT x AS "we?ird" WHERE a = ?')).toBe(
      'SELECT x AS "we?ird" WHERE a = $1',
    );
  });

  it("does not touch a question mark inside a line comment", () => {
    expect(toPositionalParams("-- why? because\nSELECT ?")).toBe(
      "-- why? because\nSELECT $1",
    );
  });

  it("preserves an existing dollar placeholder", () => {
    expect(toPositionalParams("SELECT pg_advisory_lock($1)")).toBe(
      "SELECT pg_advisory_lock($1)",
    );
  });

  it("numbers a long parameter list past nine correctly", () => {
    const sql = `VALUES (${Array(12).fill("?").join(", ")})`;
    expect(toPositionalParams(sql)).toBe(
      `VALUES (${Array.from({ length: 12 }, (_, i) => `$${i + 1}`).join(", ")})`,
    );
  });
});
