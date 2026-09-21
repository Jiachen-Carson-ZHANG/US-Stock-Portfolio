import { requireUser } from "@/lib/auth/guards";
import { EmptyState } from "@/components/ui/misc";

export const dynamic = "force-dynamic";

/**
 * Where someone lands when their account exists but nothing has been shared
 * with them yet. A blank dashboard would read as a bug; this says who to ask.
 */
export default async function NoPortfolioPage() {
  const user = await requireUser();

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold tracking-tight">Nothing to show yet</h1>
      <EmptyState
        title={`No portfolio is shared with ${user.displayName}`}
        description="Ask whoever set this up to share one with you, or to create your own. Your sign-in works — there is just nothing attached to it."
      />
    </div>
  );
}
