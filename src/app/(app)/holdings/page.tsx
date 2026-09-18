import { requireUser } from "@/lib/auth/guards";
import { loadPortfolio } from "@/lib/portfolio/service";
import { serverDictionary } from "@/lib/i18n/server";
import { LiveHoldings } from "@/components/holdings/live-holdings";
import { EmptyState } from "@/components/ui/misc";

export const dynamic = "force-dynamic";

export default async function HoldingsPage() {
  await requireUser();
  const { t } = await serverDictionary();
  const { positions, summary, allocations, totalInvested, optionGroups } =
    await loadPortfolio();

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
