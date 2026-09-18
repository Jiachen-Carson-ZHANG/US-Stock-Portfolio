import { requireUser } from "@/lib/auth/guards";
import { getDb } from "@/lib/db";
import { readWatchlist } from "@/lib/watchlist";
import { isDeepSeekConfigured } from "@/lib/deepseek";
import { WatchlistView } from "@/components/watchlist/watchlist-view";

export const dynamic = "force-dynamic";

export default async function WatchlistPage() {
  const user = await requireUser();
  const entries = readWatchlist(getDb());

  return <WatchlistView initial={entries} aiEnabled={isDeepSeekConfigured()} canRemove={user.role === "owner"} />;
}
