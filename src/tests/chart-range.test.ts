import { describe, expect, it } from "vitest";
import { chartWindow, lastSessions } from "@/lib/market/chart-range";

describe("what each chart range asks for", () => {
  const NOW = new Date("2026-09-28T15:00:00Z");

  it("sizes the candle to the range", () => {
    expect(chartWindow("1D", NOW)).toMatchObject({ interval: "5m", sessions: 1, to: "2026-09-28" });
    expect(chartWindow("1W", NOW)).toMatchObject({ interval: "30m", sessions: 5 });
    expect(chartWindow("1M", NOW)).toMatchObject({ interval: "day", from: "2026-08-28" });
    expect(chartWindow("1Y", NOW).interval).toBe("week");
    expect(chartWindow("MAX", NOW).interval).toBe("month");
  });

  it("keeps the last session that traded, so a Monday morning still shows Friday", () => {
    const bars = ["2026-09-24", "2026-09-25", "2026-09-25"].map((date, i) => ({ date, close: i }));
    expect(lastSessions(bars, 1).map((bar) => bar.date)).toEqual(["2026-09-25", "2026-09-25"]);
    expect(lastSessions(bars, 5)).toHaveLength(3);
  });
});
