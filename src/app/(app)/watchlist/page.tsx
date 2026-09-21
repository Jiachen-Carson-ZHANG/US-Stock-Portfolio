import { requirePortfolio } from "@/lib/portfolios/context";
import { getDb } from "@/lib/db";
import { readWatchlist } from "@/lib/watchlist";
import { isDeepSeekConfigured } from "@/lib/deepseek";
import { WatchlistView } from "@/components/watchlist/watchlist-view";

export const dynamic = "force-dynamic";

export default async function WatchlistPage() {
  const { user, portfolio } = await requirePortfolio();
  const entries = await readWatchlist(await getDb(), portfolio.id);

  return <WatchlistView initial={entries} aiEnabled={isDeepSeekConfigured()} canRemove={user.role === "owner"} />;
}
