"use client";

import Link from "next/link";

import { AllocationDonut } from "@/components/charts/allocation-donut";
import { ContributionBars, UnrealizedPnLBars } from "@/components/charts/pnl-bars";
import { ShareBar } from "@/components/charts/share-bar";
import { ConcentrationTiles } from "@/components/dashboard/concentration";
import { MarketStatus } from "@/components/dashboard/market-status";
import { SummaryCards } from "@/components/dashboard/summary-cards";
import { ReconciliationBanner } from "@/components/dashboard/deposits";
import { usePortfolio, type LivePortfolio } from "@/components/dashboard/use-portfolio";
import { HoldingsTable } from "@/components/holdings/holdings-table";
import { useT } from "@/lib/i18n/context";
import type { Concentration } from "@/types/portfolio";

export function LiveDashboard({
  initial,
  concentration,
  portfolioSlug,
  portfolioName,
  canWrite,
  isMock,
  since,
  ownerName,
}: {
  initial: LivePortfolio;
  concentration: Concentration;
  portfolioSlug: string;
  portfolioName: string;
  canWrite: boolean;
  isMock: boolean;
  since: string | null;
  /** Whose account it is, for explaining why you cannot trade in it. */
  ownerName: string | null;
}) {
  const t = useT();
  const { data, refreshing, failures, refresh } = usePortfolio(initial);

  // What the fills cannot account for. Dividends, interest and fees live
  // here legitimately; a transfer nobody recorded also does, and is much
  // larger.
  const unattributed =
    Number(data.summary.realizedPnL.amount) -
    Object.values(data.realizedBySymbol ?? {}).reduce((n, v) => n + v, 0);

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-lg font-semibold tracking-tight">{portfolioName}</h1>
          {isMock && canWrite && (
            <Link
              href={`/${portfolioSlug}/trade`}
              className="inline-flex min-h-9 items-center rounded-lg bg-foreground px-3 text-sm font-medium text-background transition-opacity hover:opacity-90"
            >
              {t.trade.title}
            </Link>
          )}
          {isMock && !canWrite && (
            // Without this the page simply has no button and the reader is
            // left wondering whether trading is broken or forbidden.
            <p className="text-xs text-muted-foreground">
              {ownerName
                ? `${ownerName} ${t.mockTrade.onlyOwnerCanTrade}`
                : t.mockTrade.onlyOwnerCanTradeGeneric}
            </p>
          )}
          {!isMock && <div className="flex w-full flex-wrap gap-2 sm:contents">
            <Link
              href={`/${portfolioSlug}/connection`}
              className="inline-flex min-h-10 items-center rounded-lg border border-border px-3 text-xs text-muted-foreground hover:text-foreground sm:hidden"
            >
              {t.connection.title}
            </Link>
          {canWrite && (
            // The form itself moved to the records screen. A dashboard is for
            // reading; typing bank transfers into it was always the odd one
            // out, and it is the same two clicks from here.
            <Link
              href={`/${portfolioSlug}/records`}
              className="inline-flex min-h-10 items-center rounded-lg border border-border px-3 text-xs text-muted-foreground transition-colors hover:text-foreground sm:min-h-9 sm:text-sm"
            >
              {t.records.transfer}
            </Link>
          )}
          </div>}
        </div>
        <MarketStatus
          summary={data.summary}
          refreshing={refreshing}
          failures={failures}
          onRefresh={refresh}
        />
      </header>

      {isMock && data.positions.filter((p) => p.instrumentType !== "cash").length === 0 && (
        <p className="rounded-lg border border-border bg-surface px-4 py-3 text-sm text-muted-foreground">
          {canWrite ? t.mockTrade.nothingYetOwner : t.mockTrade.nothingYet}
        </p>
      )}

      <ReconciliationBanner
        residual={unattributed}
        currency={data.summary.totalMarketValue.currency}
      />

      <SummaryCards
        summary={data.summary}
        totalInvested={data.totalInvested}
        since={since}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <AllocationDonut
          slices={data.allocations.byPosition}
          title={t.charts.allocation}
          note={t.charts.allocationNote}
          help={{ title: t.help.allocation, body: t.help.allocationBody }}
        />
        <div className="space-y-4">
          <ShareBar title={t.charts.assetType} slices={data.allocations.byAssetType} />
          <ShareBar title={t.charts.sector} slices={data.allocations.bySector} />
        </div>
      </div>

      <ContributionBars positions={data.positions} optionGroups={data.optionGroups} />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <UnrealizedPnLBars
              positions={data.positions}
              optionGroups={data.optionGroups}
              realizedBySymbol={data.realizedBySymbol ?? {}}
              unattributed={unattributed}
            />
        <ConcentrationTiles data={data.concentration ?? concentration} />
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
