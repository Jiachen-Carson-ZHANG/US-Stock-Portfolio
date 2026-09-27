import { describe, expect, it } from "vitest";
import { compareAll, type BenchmarkSeries } from "@/lib/analysis/benchmarks";
import { missingWeekdays, type AdjustedPoint } from "@/lib/analysis/math";

const series = (key: string, values: [string, number][]): BenchmarkSeries => ({
  key,
  label: key,
  points: values.map(([date, value]) => ({ date, value })),
});

describe("putting the account and the funds on one scale", () => {
  const points: AdjustedPoint[] = [
    { date: "2026-01-01", index: 100 },
    { date: "2026-01-02", index: 105 },
    { date: "2026-01-03", index: 99 },
  ] as AdjustedPoint[];

  it("starts everything at 100 on the first shared day", () => {
    const { rows } = compareAll(points, [
      series("VOO", [["2026-01-01", 500], ["2026-01-02", 505], ["2026-01-03", 495]]),
    ]);

    expect(rows[0].portfolio).toBeCloseTo(100, 6);
    expect(rows[0].VOO).toBeCloseTo(100, 6);
    expect(rows[1].portfolio).toBeCloseTo(105, 6);
    expect(rows[1].VOO).toBeCloseTo(101, 6);
  });

  it("re-bases when the window starts later, rather than keeping a stale 100", () => {
    const { rows } = compareAll(points.slice(1), [
      series("VOO", [["2026-01-02", 505], ["2026-01-03", 495]]),
    ]);
    expect(rows[0].date).toBe("2026-01-02");
    expect(rows[0].portfolio).toBeCloseTo(100, 6);
    expect(rows[1].portfolio).toBeCloseTo((99 / 105) * 100, 6);
  });

  it("drops days the account was not valued on", () => {
    const { rows } = compareAll(points, [
      series("VOO", [["2026-01-01", 500], ["2026-01-02", 505]]),
    ]);
    expect(rows.map((r) => r.date)).toEqual(["2026-01-01", "2026-01-02"]);
  });

  it("gives nothing rather than a chart of one point", () => {
    expect(compareAll(points, [series("VOO", [["2026-01-01", 500]])]).rows).toEqual([]);
    expect(compareAll(points, []).rows).toEqual([]);
  });
});

describe("how patchy the recorded history is", () => {
  it("counts nothing when every weekday is there", () => {
    // Mon to Fri, 2026-09-21 is a Monday.
    expect(
      missingWeekdays([
        "2026-09-21",
        "2026-09-22",
        "2026-09-23",
        "2026-09-24",
        "2026-09-25",
      ]),
    ).toBe(0);
  });

  it("does not count the weekend", () => {
    expect(missingWeekdays(["2026-09-25", "2026-09-28"])).toBe(0);
  });

  it("counts the weekdays that are absent", () => {
    // Monday to Friday with Tuesday, Wednesday and Thursday missing.
    expect(missingWeekdays(["2026-09-21", "2026-09-25"])).toBe(3);
  });

  it("says nothing about a single day", () => {
    expect(missingWeekdays(["2026-09-21"])).toBe(0);
    expect(missingWeekdays([])).toBe(0);
  });
});
