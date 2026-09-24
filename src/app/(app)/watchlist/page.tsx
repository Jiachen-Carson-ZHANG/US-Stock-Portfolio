import { requireUser } from "@/lib/auth/guards";
import { getDb } from "@/lib/db";
import { defaultFor } from "@/lib/portfolios";
import { getQuotes } from "@/lib/portfolio/quotes";
import { getMarketDataProvider } from "@/providers";
import { everyoneWatching, mostWatched, myWatchlist } from "@/lib/watch";
import { quoteDetail, type QuoteDetail } from "@/lib/market/detail";
import { Watchlists } from "@/components/watch/watchlists";

export const dynamic = "force-dynamic";

/**
 * The watchlist: your own list, and what everybody else is watching.
 *
 * It used to be one list for the whole family, with votes and a notes thread
 * and a link to discuss each name in the family room. The discussion moved to
 * the playground; this page is back to what a watchlist is — names you want
 * to keep an eye on, priced the way the broker prices them.
 */
export default async function WatchlistPage() {
  const user = await requireUser();
  const db = await getDb();

  const [mine, everyone, popular] = await Promise.all([
    myWatchlist(db, user.id),
    everyoneWatching(db),
    mostWatched(db),
  ]);

  // Every symbol on the page, priced in one go from the shared cache the
  // scheduler keeps warm.
  const symbols = [
    ...new Set([...mine, ...everyone.flatMap((w) => w.symbols), ...popular.map((p) => p.symbol)]),
  ];

  const details: Record<string, QuoteDetail> = {};
  if (symbols.length > 0) {
    try {
      const home = await defaultFor(db, user);
      const { quotes } = await getQuotes(
        db,
        symbols,
        await getMarketDataProvider(home?.id ?? ""),
        new Date(),
      );
      for (const [symbol, quote] of quotes) {
        details[symbol] = quoteDetail(symbol, quote.raw);
        // A symbol cached before snapshots were kept whole has only its
        // price; carry that across so the row is not blank.
        details[symbol].price ??= quote.price;
        details[symbol].previousClose ??= quote.previousClose;
        if (details[symbol].changePercent === undefined && quote.previousClose) {
          details[symbol].changePercent = quote.changePercent;
        }
      }
    } catch {
      // A price feed having a bad minute should not empty the page.
    }
  }

  return (
    <Watchlists
      me={user.id}
      mine={mine}
      everyone={everyone}
      popular={popular}
      details={details}
    />
  );
}
