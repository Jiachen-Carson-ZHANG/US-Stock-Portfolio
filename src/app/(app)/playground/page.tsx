import { requireUser } from "@/lib/auth/guards";
import { defaultFor } from "@/lib/portfolios";
import { getDb } from "@/lib/db";
import { following } from "@/lib/feed";
import { readRoom, symbolsIn } from "@/lib/playground";
import { getQuotes } from "@/lib/portfolio/quotes";
import { getMarketDataProvider } from "@/providers";
import { Playground } from "@/components/playground/room";

export const dynamic = "force-dynamic";

/**
 * Long enough to survive the database waking from suspend, which has been
 * measured at 26 seconds. Without this the platform's default cut the render
 * short and the reader got an error page instead of one slow load.
 */
export const maxDuration = 60;


export default async function PlaygroundPage() {
  const user = await requireUser();
  const db = await getDb();
  const [threads, followed] = await Promise.all([readRoom(db), following(db, user.id)]);

  // Every ticker anybody named, priced in one request rather than one per
  // post. A name shared without a price is half a conversation.
  const symbols = symbolsIn(threads);
  const prices: Record<string, { price: number; changePercent: number }> = {};
  if (symbols.length > 0) {
    try {
      // Priced through whichever portfolio this person can see, because that
      // is what decides whether there is a live broker feed to ask.
      const home = await defaultFor(db, user);
      const provider = await getMarketDataProvider(home?.id ?? "");
      const { quotes } = await getQuotes(db, symbols, provider, new Date());
      for (const [symbol, quote] of quotes) {
        prices[symbol] = { price: quote.price, changePercent: quote.changePercent };
      }
    } catch {
      // A quote feed having a bad minute should not empty the room.
    }
  }

  return (
    <Playground
      threads={threads}
      prices={prices}
      me={{ id: user.id, isAdministrator: user.role === "owner" }}
      following={followed}
    />
  );
}
