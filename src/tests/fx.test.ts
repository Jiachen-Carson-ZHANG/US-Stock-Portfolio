import { describe, expect, it } from "vitest";
import { currencyView, type RateSeries } from "@/lib/analysis/fx";
import { adjustedSeries, madeOrLostSeries } from "@/lib/analysis/math";

const rates = (cny: [string, number][]): RateSeries => ({
  USD: [],
  CNY: cny.map(([date, value]) => ({ date, value })),
  SGD: [],
  EUR: [],
});

describe("the account seen in another currency", () => {
  it("credits a later deposit with only the rate move it was there for", () => {
    // 100 dollars held from the 1st at 7.0; another 100 paid in on the 2nd at
    // 7.5. Nothing moved in dollars. In yuan, only the first hundred gained
    // from the rate: 100 x 0.5 = 50. Converting just the first and last day
    // credited both hundreds with it — 100 yuan, twice the truth.
    const view = currencyView(
      [
        { date: "2026-09-01", value: 100 },
        { date: "2026-09-02", value: 200 },
      ],
      [{ date: "2026-09-02", amount: 100 }],
      "CNY",
      "USD",
      rates([
        ["2026-09-01", 7.0],
        ["2026-09-02", 7.5],
      ]),
    )!;

    expect(view.paidIn).toBeCloseTo(750, 9);
    expect(view.madeOrLost).toBeCloseTo(50, 9);
    expect(view.fromRate).toBeCloseTo(50, 9);
    expect(view.returnPercent).toBeCloseTo((0.5 / 7) * 100, 9);
  });

  it("splits the result into the investing and the rate, which add to the whole", () => {
    const view = currencyView(
      [
        { date: "2026-09-01", value: 1000 },
        { date: "2026-09-02", value: 1100 },
        { date: "2026-09-03", value: 2150 },
      ],
      [{ date: "2026-09-03", amount: 1000 }],
      "CNY",
      "USD",
      rates([
        ["2026-09-01", 7.0],
        ["2026-09-02", 7.2],
        ["2026-09-03", 7.1],
      ]),
    )!;

    // Dollar gains: +100 on the 2nd, +50 on the 3rd, each at its own rate.
    const investing = 100 * 7.2 + 50 * 7.1;
    expect(view.madeOrLost - view.fromRate).toBeCloseTo(investing, 9);
    expect(view.madeOrLost).toBeCloseTo(2150 * 7.1 - 1000 * 7.0 - 1000 * 7.1, 9);
  });

  it("agrees with the dollar figures when the rate never moves", () => {
    const points = [
      { date: "2026-09-01", value: 1000 },
      { date: "2026-09-02", value: 1050 },
      { date: "2026-09-03", value: 2100 },
    ];
    const flows = [{ date: "2026-09-03", amount: 1000 }];
    const view = currencyView(points, flows, "CNY", "USD", rates([["2026-09-01", 7]]))!;
    const dollars = currencyView(points, flows, "USD", "USD", rates([]))!;

    expect(view.fromRate).toBeCloseTo(0, 9);
    expect(view.returnPercent).toBeCloseTo(dollars.returnPercent, 9);
    expect(view.madeOrLost).toBeCloseTo(dollars.madeOrLost * 7, 9);
    // +50 on the 2nd, and +50 on the 3rd once the 1,000 paid in is set aside.
    expect(dollars.madeOrLost).toBeCloseTo(100, 9);
  });

  it("works for an account kept in something other than dollars", () => {
    // Kept in yuan; seen in dollars. The same 7.0 -> 7.5 move, the other way.
    const view = currencyView(
      [
        { date: "2026-09-01", value: 700 },
        { date: "2026-09-02", value: 700 },
      ],
      [],
      "USD",
      "CNY",
      rates([
        ["2026-09-01", 7.0],
        ["2026-09-02", 7.5],
      ]),
    )!;

    expect(view.startValue).toBeCloseTo(100, 9);
    expect(view.endValue).toBeCloseTo(700 / 7.5, 9);
    expect(view.returnPercent).toBeCloseTo((7 / 7.5 - 1) * 100, 9);
  });

  it("gives up rather than guess when a rate is missing", () => {
    const view = currencyView(
      [
        { date: "2026-09-01", value: 100 },
        { date: "2026-09-02", value: 100 },
      ],
      [],
      "CNY",
      "USD",
      rates([]),
    );
    expect(view).toBeNull();
  });
});

describe("made or lost over time", () => {
  it("does not show a deposit as a gain, and ends on the period's gain", () => {
    const snapshots = [
      { snapshotDate: "2026-09-08", totalMarketValue: "10000" },
      { snapshotDate: "2026-09-09", totalMarketValue: "22050" },
      { snapshotDate: "2026-09-10", totalMarketValue: "21980" },
    ];
    const flows = [{ date: "2026-09-09", amount: 12000 }];
    const result = adjustedSeries(
      snapshots as never,
      flows,
      { from: "2026-09-01", to: "2026-09-30" },
    );

    const series = madeOrLostSeries(result.points, flows);
    expect(series.map((point) => point.value)).toEqual([0, 50, -20]);
    expect(series.at(-1)!.value).toBeCloseTo(result.gain!, 9);
  });
});
