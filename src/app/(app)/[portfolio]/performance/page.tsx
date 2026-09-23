import { requirePortfolio } from "@/lib/portfolios/context";
import { loadHistory, loadPortfolio, portfolioStart } from "@/lib/portfolio/service";
import { serverDictionary } from "@/lib/i18n/server";
import { AssetClassSplit } from "@/components/dashboard/asset-class-split";
import { PerformanceExplorer } from "@/components/analysis/explorer";
import { readAnalysis } from "@/lib/analysis/store";
import { PayoffExplorer } from "@/components/analysis/payoff-explorer";
import { getDb } from "@/lib/db";
import { Help } from "@/components/ui/help";
import { loadBenchmarks } from "@/lib/analysis/benchmarks-server";
import { loadRates } from "@/lib/analysis/fx-server";
import { getMarketDataProvider } from "@/providers";
export const dynamic = "force-dynamic";

/**
 * Longer than the default, for the one load a day that has to fetch the
 * benchmark closes and exchange rates rather than read them from cache.
 */
export const maxDuration = 60;
export default async function PerformancePage({
  params,
}: {
  params: Promise<{ portfolio: string }>;
}) {
  const { user, portfolio: current } = await requirePortfolio(
    (await params).portfolio,
  );
  // Three independent reads, asked for together rather than one after
  // another. Each is a round trip, and round trips are the whole cost.
  const db = await getDb();
  const [{ t }, portfolio, snapshots, analysis, openedOn] = await Promise.all([
    serverDictionary(),
    loadPortfolio(current.id),
    loadHistory(current.id),
    readAnalysis(db, current.id),
    portfolioStart(db, current.id),
  ]);
  // The funds the account is measured against, fetched from the day the first
  // money went in rather than the first day a snapshot happens to exist.
  // "What would this have done in VOO instead" is a question about your money,
  // and your money started when you paid it in; a comparison beginning three
  // months later quietly hides the first leg of the journey for both sides.
  // A failure here leaves the rest of the page intact and the chart says it
  // has nothing to compare.
  const firstSnapshot = snapshots[0]?.snapshotDate;
  const first =
    openedOn && firstSnapshot
      ? openedOn < firstSnapshot
        ? openedOn
        : firstSnapshot
      : (openedOn ?? firstSnapshot);
  const last = snapshots.at(-1)?.snapshotDate;
  const [benchmarks, rates] = await Promise.all([
    first && last
      ? loadBenchmarks(await getMarketDataProvider(current.id), first, last).catch(() => [])
      : Promise.resolve([]),
    first && last
      ? loadRates(first, last)
      : Promise.resolve({ USD: [], CNY: [], SGD: [], EUR: [] }),
  ]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="flex items-center gap-1.5 text-lg font-semibold tracking-tight">
          {t.performance.title}
          <Help title={t.help.timeWeighted}>{t.help.timeWeightedBody}</Help>
        </h1>
        {/* The range and the count belong to the section that uses them, and
            they are stated there. Repeating them here, in a second phrasing,
            was two answers to one question. */}
        <p className="mt-1 text-sm text-muted-foreground">
          {t.performance.subtitle}
        </p>
      </header>
      <AssetClassSplit data={portfolio.byAssetClass} />
      <PerformanceExplorer
        snapshots={snapshots}
        initial={analysis}
        owner={user.role === "owner"}
        currency={portfolio.summary.totalMarketValue.currency}
        benchmarks={benchmarks}
        rates={rates}
      />
      {/* The share price each option group hangs off, so the explorer can read
          volatility out of the contracts' own quotes instead of assuming one. */}
      <PayoffExplorer
        positions={portfolio.positions}
        greeks={portfolio.optionGreeks}
        underlyingPrices={Object.fromEntries(
          portfolio.optionGroups.flatMap((group) =>
            group.underlyingPrice === undefined
              ? []
              : [[group.underlying, group.underlyingPrice]],
          ),
        )}
      />
    </div>
  );
}
