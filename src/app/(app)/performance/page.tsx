import { requireUser } from "@/lib/auth/guards";
import { loadHistory, loadPortfolio } from "@/lib/portfolio/service";
import { statsFor } from "@/lib/portfolio/analytics";
import { serverDictionary } from "@/lib/i18n/server";
import { AssetClassSplit } from "@/components/dashboard/asset-class-split";
import { ValueLine } from "@/components/charts/value-line";
import { EmptyState } from "@/components/ui/misc";
import { formatPercent } from "@/lib/money";
import { signClass } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function PerformancePage() {
  await requireUser();
  const { t } = await serverDictionary();

  const snapshots = await loadHistory();
  const stats = statsFor(snapshots);
  const { byAssetClass } = await loadPortfolio();

  const tiles = [
    {
      label: t.performance.periodReturn,
      value: formatPercent(stats.periodReturnPercent, { signed: true }),
      tone: signClass(stats.periodReturnPercent),
    },
    {
      label: t.performance.maxDrawdown,
      value:
        stats.maxDrawdownPercent === null
          ? "—"
          : `−${stats.maxDrawdownPercent.toFixed(2)}%`,
      tone: "text-foreground",
    },
    {
      label: t.performance.volatility,
      value: formatPercent(stats.annualisedVolatilityPercent),
      tone: "text-foreground",
    },
    {
      label: t.performance.bestWorst,
      value:
        stats.bestDayPercent === null
          ? "—"
          : `${formatPercent(stats.bestDayPercent, { signed: true })} / ${formatPercent(
              stats.worstDayPercent,
              { signed: true },
            )}`,
      tone: "text-foreground",
    },
  ];

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

        <AssetClassSplit data={byAssetClass} />

        {snapshots.length < 2 ? (
          <EmptyState
            title={t.performance.notEnough}
            description={t.performance.notEnoughHint}
          />
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              {tiles.map((tile) => (
                <div
                  key={tile.label}
                  className="rounded-xl border border-border bg-surface p-5"
                >
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {tile.label}
                  </p>
                  <p
                    className={`mt-2 text-xl font-semibold tracking-tight ${tile.tone}`}
                  >
                    {tile.value}
                  </p>
                </div>
              ))}
            </div>

            <ValueLine
              title={t.charts.portfolioValue}
              valueLabel={t.charts.portfolioValue}
              height={320}
              data={snapshots.map((s) => ({
                date: s.snapshotDate,
                value: Number(s.totalMarketValue),
              }))}
            />

            <ValueLine
              title={t.summary.unrealized}
              valueLabel={t.summary.unrealized}
              data={snapshots.map((s) => ({
                date: s.snapshotDate,
                value: Number(s.totalUnrealizedPnL),
              }))}
            />
          </>
        )}
    </div>
  );
}
