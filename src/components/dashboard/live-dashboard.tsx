"use client";

import { AllocationDonut } from "@/components/charts/allocation-donut";
import { ContributionBars, UnrealizedPnLBars } from "@/components/charts/pnl-bars";
import { ShareBar } from "@/components/charts/share-bar";
import { ConcentrationTiles } from "@/components/dashboard/concentration";
import { MarketStatus } from "@/components/dashboard/market-status";
import { SummaryCards } from "@/components/dashboard/summary-cards";
import { usePortfolio, type LivePortfolio } from "@/components/dashboard/use-portfolio";
import { HoldingsTable } from "@/components/holdings/holdings-table";
import { useT } from "@/lib/i18n/context";
import type { Concentration } from "@/types/portfolio";

export function LiveDashboard({
  initial,
  concentration,
}: {
  initial: LivePortfolio;
  concentration: Concentration;
}) {
  const t = useT();
  const { data, refreshing, refresh } = usePortfolio(initial);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-lg font-semibold tracking-tight">{t.nav.overview}</h1>
        <MarketStatus
          summary={data.summary}
          refreshing={refreshing}
          onRefresh={refresh}
        />
      </header>

      <SummaryCards summary={data.summary} totalInvested={data.totalInvested} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <AllocationDonut
          slices={data.allocations.byPosition}
          title={t.charts.allocation}
          note={t.charts.allocationNote}
        />
        <div className="space-y-4">
          <ShareBar title={t.charts.assetType} slices={data.allocations.byAssetType} />
          <ShareBar title={t.charts.sector} slices={data.allocations.bySector} />
        </div>
      </div>

      <ContributionBars positions={data.positions} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <UnrealizedPnLBars positions={data.positions} />
        <ConcentrationTiles data={concentration} />
      </div>

      <section className="space-y-3">
        <h2 className="text-sm font-medium">{t.table.holdings}</h2>
        <HoldingsTable
          positions={data.positions}
          optionGroups={data.optionGroups}
        />
      </section>
    </div>
  );
}
