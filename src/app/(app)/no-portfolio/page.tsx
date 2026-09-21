import { requireUser } from "@/lib/auth/guards";
import { EmptyState } from "@/components/ui/misc";
import { serverDictionary } from "@/lib/i18n/server";

export const dynamic = "force-dynamic";

/**
 * Where someone lands when their account exists but nothing has been shared
 * with them yet. A blank dashboard would read as a bug; this says who to ask.
 */
export default async function NoPortfolioPage() {
  const user = await requireUser();
  const { t } = await serverDictionary();

  return (
    <div className="space-y-6">
      <h1 className="text-lg font-semibold tracking-tight">{t.access.noPortfolioTitle}</h1>
      <EmptyState
        title={user.displayName}
        description={t.access.noPortfolioBody}
      />
    </div>
  );
}
