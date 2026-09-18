import { requireUser } from "@/lib/auth/guards";
import { loadPortfolio } from "@/lib/portfolio/service";
import { LiveDashboard } from "@/components/dashboard/live-dashboard";
import { EmptyState } from "@/components/ui/misc";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  await requireUser();
  const { summary, positions, allocations, concentration } = await loadPortfolio();

  if (positions.length === 0) {
    return (
      <div className="space-y-6">
        <h1 className="text-lg font-semibold tracking-tight">Overview</h1>
        <EmptyState
          title="No holdings yet"
          description="Run the seed script, or sync the account from Settings."
        />
      </div>
    );
  }

  return (
    <LiveDashboard
      initial={{ summary, positions, allocations }}
      concentration={concentration}
    />
  );
}
