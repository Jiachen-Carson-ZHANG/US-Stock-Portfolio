import { getDb } from "@/lib/db";
import { canWrite } from "@/lib/portfolios";
import { requirePortfolio } from "@/lib/portfolios/context";
import { loadPortfolio } from "@/lib/portfolio/service";
import { serverDictionary } from "@/lib/i18n/server";
import { LiveDashboard } from "@/components/dashboard/live-dashboard";
import { EmptyState } from "@/components/ui/misc";

export const dynamic = "force-dynamic";

export default async function DashboardPage({
  params,
}: {
  params: Promise<{ portfolio: string }>;
}) {
  const { user, portfolio } = await requirePortfolio((await params).portfolio);
  const { t } = await serverDictionary();
  const {
    summary,
    positions,
    allocations,
    concentration,
    totalInvested,
    optionGroups,
    realizedBySymbol,
} = await loadPortfolio(portfolio.id);

  // What "total" is measured from: the first money in, or failing that the
  // first day on record.
  const db = await getDb();
  const origin = await db.get<{ date: string | null }>(
    `SELECT LEAST(
              (SELECT MIN(date) FROM analysis_flows WHERE portfolio_id = $1),
              (SELECT MIN(snapshot_date) FROM portfolio_snapshots WHERE portfolio_id = $1)
            ) AS date`,
    [portfolio.id],
  );
  const since = origin?.date ?? null;

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
      portfolioSlug={portfolio.slug}
      portfolioName={portfolio.displayName}
      canWrite={canWrite(user, portfolio)}
      isMock={portfolio.kind === "mock"}
      since={since}
      initial={{ summary, positions, allocations, totalInvested, optionGroups, realizedBySymbol }}
      concentration={concentration}
    />
  );
}
