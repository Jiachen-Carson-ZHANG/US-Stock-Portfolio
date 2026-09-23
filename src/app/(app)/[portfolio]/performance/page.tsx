import { requirePortfolio } from "@/lib/portfolios/context";
import { loadHistory, loadPortfolio } from "@/lib/portfolio/service";
import { serverDictionary } from "@/lib/i18n/server";
import { AssetClassSplit } from "@/components/dashboard/asset-class-split";
import { PerformanceExplorer } from "@/components/analysis/explorer";
import { readAnalysis } from "@/lib/analysis/store";
import { PayoffExplorer } from "@/components/analysis/payoff-explorer";
import { getDb } from "@/lib/db";
import { Help } from "@/components/ui/help";
import { loadBenchmarks } from "@/lib/analysis/benchmarks";
import { loadRates } from "@/lib/analysis/fx";
import { getMarketDataProvider } from "@/providers";
export const dynamic = "force-dynamic";
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
  const [{ t }, portfolio, snapshots, analysis] = await Promise.all([
    serverDictionary(),
    loadPortfolio(current.id),
    loadHistory(current.id),
    getDb().then((db) => readAnalysis(db, current.id)),
  ]);
  // The funds the account is measured against, over exactly the window it
  // has been measured for. Asked for after the snapshots because the window
  // is what they are fetched for; a failure here leaves the rest of the page
  // intact and the chart simply says it has nothing to compare.
  const first = snapshots[0]?.snapshotDate;
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
        <p className="mt-1 text-sm text-muted-foreground">
          {t.performance.basedOn} {snapshots.length} {t.performance.snapshots}
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
