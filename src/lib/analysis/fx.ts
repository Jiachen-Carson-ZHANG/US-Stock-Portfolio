import { logger } from "@/lib/logger";

/**
 * What the account is worth to the people looking at it.
 *
 * The family is split between China and Singapore, so "up $1,200" is not the
 * whole story: the same dollars can be worth less in yuan than they were last
 * month even when the account went up. This turns one account into four
 * honest answers.
 *
 * moomoo does not publish exchange rates — its API covers US equities and
 * options, and nothing else — so the rates come from the European Central
 * Bank's published daily reference rates, via Frankfurter, which is free,
 * needs no key and is the same series banks quote against. USD is included
 * as the identity so every view is built the same way.
 */
export const VIEW_CURRENCIES = ["USD", "CNY", "SGD", "EUR"] as const;
export type ViewCurrency = (typeof VIEW_CURRENCIES)[number];

export const CURRENCY_LABEL: Record<ViewCurrency, { en: string; zh: string }> = {
  USD: { en: "US dollars", zh: "美元" },
  CNY: { en: "Chinese yuan", zh: "人民币" },
  SGD: { en: "Singapore dollars", zh: "新加坡元" },
  EUR: { en: "Euros", zh: "欧元" },
};

export type RateSeries = Record<ViewCurrency, { date: string; value: number }[]>;

type FrankfurterResponse = {
  rates?: Record<string, Record<string, number>>;
};

// The .dev host, not .app: the older one answers with a permanent redirect,
// which a fetch that does not follow redirects reads as a failure.
const ENDPOINT = "https://api.frankfurter.dev/v1";

/**
 * Daily USD rates across the window, one request for every currency.
 *
 * Cached for half a day: these are one published number per currency per
 * day, so asking more often than that spends a round trip to learn nothing.
 * A failure returns what it has rather than throwing — a page that cannot
 * reach a rate server should still show the dollar view.
 */
export async function loadRates(from: string, to: string): Promise<RateSeries> {
  const empty: RateSeries = { USD: [], CNY: [], SGD: [], EUR: [] };
  if (!from || !to) return empty;

  const wanted = VIEW_CURRENCIES.filter((code) => code !== "USD");

  try {
    const response = await fetch(
      `${ENDPOINT}/${from}..${to}?base=USD&symbols=${wanted.join(",")}`,
      { next: { revalidate: 43_200 }, signal: AbortSignal.timeout(8_000) },
    );
    if (!response.ok) return empty;

    const body = (await response.json()) as FrankfurterResponse;
    const rates = body.rates ?? {};

    const series: RateSeries = { USD: [], CNY: [], SGD: [], EUR: [] };
    for (const [date, row] of Object.entries(rates)) {
      // One dollar is one dollar, on every date the others have.
      series.USD.push({ date, value: 1 });
      for (const code of wanted) {
        const value = row[code];
        if (Number.isFinite(value) && value > 0) series[code].push({ date, value });
      }
    }

    for (const code of VIEW_CURRENCIES) {
      series[code].sort((a, b) => a.date.localeCompare(b.date));
    }
    return series;
  } catch (error) {
    logger.warn("fx.rates.unavailable", {
      reason: error instanceof Error ? error.message : "unknown",
    });
    return empty;
  }
}

/**
 * The rate on a date, or the most recent one before it.
 *
 * Rates are published on business days and a portfolio snapshot can land on
 * one that has none — a holiday in Frankfurt is not a holiday in New York.
 * Carrying the last published rate forward is what every accounting system
 * does, and is far better than dropping the day.
 */
export function rateOn(
  series: { date: string; value: number }[],
  date: string,
): number | null {
  let found: number | null = null;
  for (const point of series) {
    if (point.date > date) break;
    found = point.value;
  }
  return found;
}
