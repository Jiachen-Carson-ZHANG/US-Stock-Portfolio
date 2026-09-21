import { requirePortfolio } from "@/lib/portfolios/context";
import { loadHistory, loadPortfolio } from "@/lib/portfolio/service";
import { serverDictionary } from "@/lib/i18n/server";
import { AssetClassSplit } from "@/components/dashboard/asset-class-split";
import { PerformanceExplorer } from "@/components/analysis/explorer";
import { readAnalysis } from "@/lib/analysis/store";
import { PayoffExplorer } from "@/components/analysis/payoff-explorer";
import { getDb } from "@/lib/db";
export const dynamic = "force-dynamic";
export default async function PerformancePage({
  params,
}: {
  params: Promise<{ portfolio: string }>;
}) {
  const { user, portfolio: current } = await requirePortfolio(
    (await params).portfolio,
  );
  const { t } = await serverDictionary();
  const portfolio = await loadPortfolio(current.id);
  const snapshots = await loadHistory(current.id);
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-lg font-semibold tracking-tight">
          {t.performance.title}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t.performance.basedOn} {snapshots.length} {t.performance.snapshots}
        </p>
      </header>
      <AssetClassSplit data={portfolio.byAssetClass} />
      <PerformanceExplorer
        snapshots={snapshots}
        initial={await readAnalysis(await getDb(), current.id)}
        owner={user.role === "owner"}
        currency={portfolio.summary.totalMarketValue.currency}
      />
      <PayoffExplorer positions={portfolio.positions} />
    </div>
  );
}
