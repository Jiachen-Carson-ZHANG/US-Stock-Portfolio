import Link from "next/link";
import { getDb } from "@/lib/db";
import { canWrite } from "@/lib/portfolios";
import { requirePortfolio } from "@/lib/portfolios/context";
import { loadPortfolio, portfolioStart } from "@/lib/portfolio/service";
import { serverDictionary } from "@/lib/i18n/server";
import { LiveDashboard } from "@/components/dashboard/live-dashboard";
import { EmptyState } from "@/components/ui/misc";

export const dynamic = "force-dynamic";

/**
 * Long enough to survive the database waking from suspend, which has been
 * measured at 26 seconds. Without this the platform's default cut the render
 * short and the reader got an error page instead of one slow load.
 */
export const maxDuration = 60;


export default async function DashboardPage({
  params,
}: {
  params: Promise<{ portfolio: string }>;
}) {
  const { user, portfolio } = await requirePortfolio((await params).portfolio);
  const db = await getDb();

  // Four independent lookups. Asking for them one after another meant four
  // separate waits on the database; asked for together it is one.
  // `since` is what "total" is measured from: the first money in, or failing
  // that the first day on record.
  const [{ t }, data, since, owner] = await Promise.all([
    serverDictionary(),
    loadPortfolio(portfolio.id),
    portfolioStart(db, portfolio.id),
    portfolio.ownerUserId
      ? db.get<{ display_name: string }>(`SELECT display_name FROM users WHERE id = ?`, [
          portfolio.ownerUserId,
        ])
      : null,
  ]);

  const {
    summary,
    positions,
    allocations,
    concentration,
    totalInvested,
    optionGroups,
    realizedBySymbol,
  } = data;
  const ownerName = owner?.display_name ?? null;

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
    {portfolio.kind === "broker" && <Link className="hidden text-sm underline sm:inline" href={`/${portfolio.slug}/connection`}>Broker connection and refresh</Link>}
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
