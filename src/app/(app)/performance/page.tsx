import { requireUser } from "@/lib/auth/guards";
import { loadHistory } from "@/lib/portfolio/service";
import { statsFor } from "@/lib/portfolio/analytics";
import { ValueLine } from "@/components/charts/value-line";
import { EmptyState } from "@/components/ui/misc";
import { formatPercent } from "@/lib/money";
import { signClass } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function PerformancePage() {
  await requireUser();
  const snapshots = loadHistory();
  const stats = statsFor(snapshots);

  const tiles = [
    {
      label: "Period return",
      value: formatPercent(stats.periodReturnPercent, { signed: true }),
      tone: signClass(stats.periodReturnPercent),
    },
    {
      label: "Max drawdown",
      value: stats.maxDrawdownPercent === null
        ? "—"
        : `−${stats.maxDrawdownPercent.toFixed(2)}%`,
      tone: "text-foreground",
    },
    {
      label: "Annualised volatility",
      value: formatPercent(stats.annualisedVolatilityPercent),
      tone: "text-foreground",
    },
    {
      label: "Best / worst day",
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
        <h1 className="text-lg font-semibold tracking-tight">Performance</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Based on {snapshots.length} daily snapshot{snapshots.length === 1 ? "" : "s"}.
        </p>
      </header>

      {snapshots.length < 2 ? (
        <EmptyState
          title="Not enough history yet"
          description="A snapshot is recorded once per trading day after the US close."
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
                <p className={`mt-2 text-xl font-semibold tracking-tight ${tile.tone}`}>
                  {tile.value}
                </p>
              </div>
            ))}
          </div>

          <ValueLine
            title="Portfolio value"
            valueLabel="Portfolio value"
            height={320}
            data={snapshots.map((s) => ({
              date: s.snapshotDate,
              value: Number(s.totalMarketValue),
            }))}
          />

          <ValueLine
            title="Unrealized P&L"
            valueLabel="Unrealized P&L"
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
