import { describe, expect, it } from "vitest";
import {
  isAfterMarketClose,
  isMarketOpen,
  marketDateString,
  marketSession,
  quotePollIntervalMs,
} from "@/lib/market-hours";

// 2026-09-18 is a Friday; 2026-09-19 a Saturday. Times below are UTC, and
// September is EDT (UTC-4), so 13:30Z is the 09:30 ET opening bell.
describe("US market sessions", () => {
  it("is closed overnight", () => {
    expect(marketSession(new Date("2026-09-18T06:00:00Z"))).toBe("closed");
  });

  it("is pre-market between 04:00 and 09:30 ET", () => {
    expect(marketSession(new Date("2026-09-18T08:30:00Z"))).toBe("pre-market");
    expect(marketSession(new Date("2026-09-18T13:29:00Z"))).toBe("pre-market");
  });

  it("is regular from the opening bell to the close", () => {
    expect(marketSession(new Date("2026-09-18T13:30:00Z"))).toBe("regular");
    expect(marketSession(new Date("2026-09-18T19:59:00Z"))).toBe("regular");
    expect(isMarketOpen(new Date("2026-09-18T15:00:00Z"))).toBe(true);
  });

  it("is after-hours from 16:00 to 20:00 ET", () => {
    expect(marketSession(new Date("2026-09-18T20:00:00Z"))).toBe("after-hours");
    expect(marketSession(new Date("2026-09-18T23:59:00Z"))).toBe("after-hours");
  });

  it("is closed all weekend", () => {
    expect(marketSession(new Date("2026-09-19T15:00:00Z"))).toBe("closed");
    expect(marketSession(new Date("2026-09-20T15:00:00Z"))).toBe("closed");
  });

  it("stops polling once the market is closed", () => {
    // Nothing can move, so re-asking spends the broker's rate limit to learn
    // the same number.
    expect(quotePollIntervalMs("closed")).toBeNull();
  });

  it("polls fastest in the regular session and slower in extended hours", () => {
    const regular = quotePollIntervalMs("regular");
    const pre = quotePollIntervalMs("pre-market");
    const after = quotePollIntervalMs("after-hours");
    expect(regular).not.toBeNull();
    expect(pre).not.toBeNull();
    expect(regular!).toBeLessThan(pre!);
    expect(after).toBe(pre);
  });

  it("reports the market-local date, not the UTC date", () => {
    // 01:00Z Saturday is still Friday evening in New York.
    expect(marketDateString(new Date("2026-09-19T01:00:00Z"))).toBe("2026-09-18");
  });

  it("only flags after-close on a weekday past 16:00 ET", () => {
    expect(isAfterMarketClose(new Date("2026-09-18T19:00:00Z"))).toBe(false);
    expect(isAfterMarketClose(new Date("2026-09-18T20:30:00Z"))).toBe(true);
    expect(isAfterMarketClose(new Date("2026-09-19T20:30:00Z"))).toBe(false);
  });
});
