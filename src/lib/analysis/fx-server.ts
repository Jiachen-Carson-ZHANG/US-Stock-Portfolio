import "server-only";
import { logger } from "@/lib/logger";
import { observe } from "@/lib/observe";
import { cachedSeries, DAILY_TTL_MS } from "./series-cache";
import { VIEW_CURRENCIES, type RateSeries } from "./fx";

/**
 * Fetching the exchange rates.
 *
 * Split from the currency list and the lookup beside it, which the table
 * re-runs in the browser and so must not reach the network.
 */
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
  // One published number per currency per day, so asking more often than
  // that spends a round trip to learn nothing.
  return cachedSeries(`fx:${from}:${to}`, DAILY_TTL_MS, () =>
    observe("analysis.fx", null, () => fetchRates(from, to)),
  );
}

async function fetchRates(from: string, to: string): Promise<RateSeries> {
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

