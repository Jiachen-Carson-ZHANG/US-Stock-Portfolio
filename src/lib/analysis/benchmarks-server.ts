import "server-only";
import type { MarketDataProvider } from "@/providers/market-data/types";
import { observe } from "@/lib/observe";
import { cachedSeries, DAILY_TTL_MS } from "./series-cache";
import { BENCHMARKS, equalMix, type BenchmarkSeries } from "./benchmarks";

/**
 * Fetching the benchmark closes.
 *
 * Separate from the maths beside it because this needs a broker connection
 * and the database, and the comparison it feeds runs in the browser.
 */
/** Long enough for three history calls on a good day, short enough to abandon. */
const FETCH_DEADLINE_MS = 8_000;

/**
 * Whatever finishes first: the work, or the clock.
 *
 * The abandoned work is left to finish in the background — its result still
 * lands in the cache, so the next reader gets it for nothing.
 */
function withDeadline<T>(work: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

export async function loadBenchmarks(
  provider: MarketDataProvider,
  from: string,
  to: string,
): Promise<BenchmarkSeries[]> {
  // Daily closes, cached for the day. Three broker calls on every render of
  // the performance page was most of what made it slow, and all of what made
  // it time out.
  return cachedSeries(`benchmarks:${from}:${to}`, DAILY_TTL_MS, () =>
    observe("analysis.benchmarks", null, () =>
      // A cap on the whole thing, not on each call. The comparison is the
      // least important part of the page, and it is not worth the page: one
      // broker request that never answers used to take the entire render down
      // with it and show "something did not answer in time".
      withDeadline(fetchBenchmarks(provider, from, to), FETCH_DEADLINE_MS, []),
    ),
  );
}

async function fetchBenchmarks(
  provider: MarketDataProvider,
  from: string,
  to: string,
): Promise<BenchmarkSeries[]> {
  const loaded = await Promise.all(
    BENCHMARKS.map(async ({ key, label }): Promise<BenchmarkSeries | null> => {
      try {
        const history = await provider.getHistoricalPrices(key, { from, to });
        const points = history
          .filter((row) => Number.isFinite(row.close) && row.close > 0)
          .map((row) => ({ date: row.date, value: row.close }));
        return points.length >= 2 ? { key, label, points } : null;
      } catch {
        return null;
      }
    }),
  );

  const series = loaded.filter((item): item is BenchmarkSeries => item !== null);
  const blend = equalMix(series);
  return blend ? [...series, blend] : series;
}

