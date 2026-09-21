import { requireUser } from "@/lib/auth/guards";
import { loadPortfolio } from "@/lib/portfolio/service";
import { serverDictionary } from "@/lib/i18n/server";
import { LiveDashboard } from "@/components/dashboard/live-dashboard";
import { EmptyState } from "@/components/ui/misc";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  await requireUser();
  const { t } = await serverDictionary();
  const {
    summary,
    positions,
    allocations,
    concentration,
    totalInvested,
    optionGroups,
    realizedBySymbol,
} = await loadPortfolio();

  if (positions.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-lg font-semibold tracking-tight">{t.nav.overview}</h1>
        <EmptyState title={t.table.noHoldings} description={t.table.noHoldingsHint} />
      </div>
    );
  }

  return (
    <LiveDashboard
      initial={{ summary, positions, allocations, totalInvested, optionGroups, realizedBySymbol }}
      concentration={concentration}
    />
  );
}
