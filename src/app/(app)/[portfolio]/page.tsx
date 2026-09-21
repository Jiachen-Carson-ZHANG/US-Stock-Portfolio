import Link from "next/link";
import { getDb } from "@/lib/db";
import { canWrite } from "@/lib/portfolios";
import { requirePortfolio } from "@/lib/portfolios/context";
import { loadPortfolio, portfolioStart } from "@/lib/portfolio/service";
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
  const since = await portfolioStart(db, portfolio.id);
  const ownerName = portfolio.ownerUserId
    ? ((
        await db.get<{ display_name: string }>(
          `SELECT display_name FROM users WHERE id = ?`,
          [portfolio.ownerUserId],
        )
      )?.display_name ?? null)
    : null;

  if (positions.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-lg font-semibold tracking-tight">{t.nav.overview}</h1>
        {portfolio.kind === "broker" && <Link href={`/${portfolio.slug}/connection`}>Broker connection</Link>}
        <EmptyState title={t.table.noHoldings} description={t.table.noHoldingsHint} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
    {portfolio.kind === "broker" && <Link className="text-sm underline" href={`/${portfolio.slug}/connection`}>Broker connection and refresh</Link>}
    <LiveDashboard
      portfolioSlug={portfolio.slug}
      portfolioName={portfolio.displayName}
      canWrite={canWrite(user, portfolio)}
      isMock={portfolio.kind === "mock"}
      since={since}
      ownerName={ownerName}
      initial={{ summary, positions, allocations, totalInvested, optionGroups, realizedBySymbol }}
      concentration={concentration}
    />
    </div>
  );
}
