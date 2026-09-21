import { requirePortfolio } from "@/lib/portfolios/context";
import { loadPortfolio } from "@/lib/portfolio/service";
import { serverDictionary } from "@/lib/i18n/server";
import { LiveHoldings } from "@/components/holdings/live-holdings";
import { EmptyState } from "@/components/ui/misc";

export const dynamic = "force-dynamic";

export default async function HoldingsPage({
  params,
}: {
  params: Promise<{ portfolio: string }>;
}) {
  const { portfolio } = await requirePortfolio((await params).portfolio);
  const { t } = await serverDictionary();
  const { positions, summary, allocations, totalInvested, optionGroups } =
    await loadPortfolio(portfolio.id);

  if (positions.length === 0) {
    return (
      <div className="space-y-5">
        <h1 className="text-lg font-semibold tracking-tight">{t.nav.holdings}</h1>
        <EmptyState title={t.table.noHoldings} description={t.table.noHoldingsHint} />
      </div>
    );
  }

  return (
    <LiveHoldings
      initial={{ summary, positions, allocations, totalInvested, optionGroups }}
    />
  );
}
