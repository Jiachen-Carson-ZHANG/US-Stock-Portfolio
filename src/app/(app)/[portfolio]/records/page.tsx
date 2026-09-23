import { notFound } from "next/navigation";
import { getDb } from "@/lib/db";
import { serverDictionary } from "@/lib/i18n/server";
import { canWrite } from "@/lib/portfolios";
import { requirePortfolio } from "@/lib/portfolios/context";
import { baseCurrency, loadHistory } from "@/lib/portfolio/service";
import { readAnalysis } from "@/lib/analysis/store";
import { AddDeposit } from "@/components/dashboard/deposits";
import { PerformanceExplorer } from "@/components/analysis/explorer";
import { BackLink } from "@/components/ui/back-link";

export const dynamic = "force-dynamic";

/**
 * Where the numbers the app cannot work out for itself get typed in.
 *
 * Two jobs that were scattered across other screens: recording a transfer in
 * or out, and maintaining the reference data the performance maths needs
 * (cash flows, the reviewed period, benchmark and exchange-rate series).
 * Both are bookkeeping. Neither belongs underneath a chart somebody is
 * trying to read, which is where they were.
 */
export default async function RecordsPage({
  params,
}: {
  params: Promise<{ portfolio: string }>;
}) {
  const { user, portfolio } = await requirePortfolio((await params).portfolio);
  if (!canWrite(user, portfolio)) notFound();

  const db = await getDb();
  const [{ t }, snapshots, analysis] = await Promise.all([
    serverDictionary(),
    loadHistory(portfolio.id),
    readAnalysis(db, portfolio.id),
  ]);

  return (
    <div className="space-y-6">
      <BackLink href={`/${portfolio.slug}`} label={t.nav.overview} />

      <header>
        <h1 className="text-lg font-semibold tracking-tight">{t.records.title}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{t.records.subtitle}</p>
      </header>

      <section className="rounded-xl border border-border bg-surface p-5">
        <h2 className="text-sm font-medium">{t.records.transfer}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t.records.transferHint}</p>
        <div className="mt-3">
          <AddDeposit portfolioSlug={portfolio.slug} currency={baseCurrency()} />
        </div>
      </section>

      <PerformanceExplorer
        mode="manage"
        snapshots={snapshots}
        initial={analysis}
        // Whoever may write this portfolio, which the guard above has already
        // established, and which is the same rule the analysis API enforces.
        owner
        currency={baseCurrency()}
      />
    </div>
  );
}
