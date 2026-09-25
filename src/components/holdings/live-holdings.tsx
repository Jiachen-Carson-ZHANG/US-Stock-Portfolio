"use client";

import { MarketStatus } from "@/components/dashboard/market-status";
import { usePortfolio, type LivePortfolio } from "@/components/dashboard/use-portfolio";
import { HoldingsTable } from "@/components/holdings/holdings-table";
import { useT } from "@/lib/i18n/context";

export function LiveHoldings({
  initial,
  portfolioSlug,
}: {
  initial: LivePortfolio;
  portfolioSlug: string;
}) {
  const t = useT();
  const { data, refreshing, refresh } = usePortfolio(initial, portfolioSlug);

  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <h1 className="text-lg font-semibold tracking-tight">{t.nav.holdings}</h1>
        <MarketStatus
          summary={data.summary}
          refreshing={refreshing}
          onRefresh={refresh}
        />
      </header>

      <HoldingsTable positions={data.positions} optionGroups={data.optionGroups} />
    </div>
  );
}
