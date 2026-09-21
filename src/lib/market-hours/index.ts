import type { MarketSession } from "@/types/market";

const MARKET_TIMEZONE = "America/New_York";

const PRE_MARKET_OPEN = 4 * 60;
const REGULAR_OPEN = 9 * 60 + 30;
const REGULAR_CLOSE = 16 * 60;
const AFTER_HOURS_CLOSE = 20 * 60;

type MarketClock = {
  minutesOfDay: number;
  weekday: number;
};

function marketClock(now: Date): MarketClock {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: MARKET_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hour12: false,
  }).formatToParts(now);

  const lookup = (type: string) =>
    parts.find((part) => part.type === type)?.value ?? "";

  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return {
    minutesOfDay: Number(lookup("hour")) * 60 + Number(lookup("minute")),
    weekday: weekdays.indexOf(lookup("weekday")),
  };
}

/**
 * Session by US Eastern wall clock. Market holidays are not modelled, so a
 * holiday weekday reads as its normal session rather than "closed".
 */
export function marketSession(now: Date = new Date()): MarketSession {
  const { minutesOfDay, weekday } = marketClock(now);
  if (weekday === 0 || weekday === 6) return "closed";
  if (minutesOfDay < PRE_MARKET_OPEN) return "closed";
  if (minutesOfDay < REGULAR_OPEN) return "pre-market";
  if (minutesOfDay < REGULAR_CLOSE) return "regular";
  if (minutesOfDay < AFTER_HOURS_CLOSE) return "after-hours";
  return "closed";
}

export function isMarketOpen(now: Date = new Date()): boolean {
  return marketSession(now) === "regular";
}

/**
 * How often to re-ask the server, or null to stop entirely.
 *
 * Nothing moves when the market is closed, so polling then spends the broker's
 * rate limit and the family's battery to re-fetch a number that cannot have
 * changed. The page already says "Market closed · Last updated", which is the
 * honest thing to show instead.
 *
 * Extended hours do move, just thinly, so they poll at a slower cadence than
 * the regular session rather than not at all.
 */
export function quotePollIntervalMs(session: MarketSession): number | null {
  switch (session) {
    case "regular":
      return 5_000;
    case "pre-market":
    case "after-hours":
      return 30_000;
    case "closed":
      return null;
  }
}

export function marketSessionLabel(session: MarketSession): string {
  switch (session) {
    case "pre-market":
      return "Pre-market";
    case "regular":
      return "Market open";
    case "after-hours":
      return "After hours";
    case "closed":
      return "Market closed";
  }
}

export function marketDateString(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: MARKET_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** True once the regular session has ended for the day (§21 snapshot trigger). */
export function isAfterMarketClose(now: Date = new Date()): boolean {
  const { minutesOfDay, weekday } = marketClock(now);
  if (weekday === 0 || weekday === 6) return false;
  return minutesOfDay >= REGULAR_CLOSE;
}
