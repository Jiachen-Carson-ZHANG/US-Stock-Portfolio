import { requireUser } from "@/lib/auth/guards";
import { loadPortfolio } from "@/lib/portfolio/service";
import { HoldingsTable } from "@/components/holdings/holdings-table";
import { MarketStatus } from "@/components/dashboard/market-status";
import { EmptyState } from "@/components/ui/misc";

export const dynamic = "force-dynamic";

export default async function HoldingsPage() {
  await requireUser();
  const { positions, summary } = await loadPortfolio();

  return (
    <div className="space-y-5">
      <header className="space-y-2">
        <h1 className="text-lg font-semibold tracking-tight">Holdings</h1>
        <MarketStatus summary={summary} />
      </header>

      {positions.length === 0 ? (
        <EmptyState
          title="No holdings yet"
          description="Run the seed script, or sync the account from Settings."
        />
      ) : (
        <HoldingsTable positions={positions} />
      )}
    </div>
  );
}
