import { rejectCrossOrigin } from '@/lib/http/origin';
import { authenticateRequest, requireApiOwner, unauthorized } from "@/lib/auth/guards";
import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";
import { recordActivity } from "@/lib/activity";
import { watchlistAddSchema, watchlistRemoveSchema } from "@/lib/schemas";
import {
  addToWatchlist,
  readWatchlist,
  removeFromWatchlist,
} from "@/lib/watchlist";
import { getMarketDataProvider } from "@/providers";

async function withQuotes(entries: Awaited<ReturnType<typeof readWatchlist>>) {
  if (entries.length === 0) return entries;

  try {
    const quotes = await (await getMarketDataProvider()).getQuotes(
      entries.map((entry) => entry.symbol),
    );
    const bySymbol = new Map(quotes.map((quote) => [quote.symbol, quote]));

    return entries.map((entry) => {
      const quote = bySymbol.get(entry.symbol);
      return quote
        ? { ...entry, price: quote.price, changePercent: quote.changePercent }
        : entry;
    });
  } catch {
    // The list is still useful without live prices.
    return entries;
  }
}

export async function GET() {
  const user = await authenticateRequest();
  if (!user) return unauthorized();

  return Response.json({
    entries: await withQuotes(await readWatchlist(await getDb())),
  });
}

export async function POST(request: Request) {
  const originError=rejectCrossOrigin(request); if(originError) return originError;
  const user = await authenticateRequest();
  if (!user) return unauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = watchlistAddSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid entry" },
      { status: 400 },
    );
  }

  const db = await getDb();
  const entry = await addToWatchlist(db, {
    symbol: parsed.data.symbol,
    name: parsed.data.name,
    reason: parsed.data.reason,
    addedBy: user.displayName,
  });

  await recordActivity(db, {
    userId: user.id,
    username: user.username,
    kind: "watchlist_add",
    target: entry.symbol,
  });
  logger.info("watchlist.added", { symbol: entry.symbol, by: user.username });

  return Response.json({ entry });
}

export async function DELETE(request: Request) {
  const originError=rejectCrossOrigin(request); if(originError) return originError;
  const auth = await requireApiOwner();
  if ("response" in auth) return auth.response;
  const user = auth.user;

  const parsed = watchlistRemoveSchema.safeParse({
    symbol: new URL(request.url).searchParams.get("symbol") ?? "",
  });
  if (!parsed.success) {
    return Response.json({ error: "Invalid symbol" }, { status: 400 });
  }

  const db = await getDb();
  const removed = await removeFromWatchlist(db, parsed.data.symbol);

  if (removed) {
    await recordActivity(db, {
      userId: user.id,
      username: user.username,
      kind: "watchlist_remove",
      target: parsed.data.symbol.toUpperCase(),
    });
  }

  return Response.json({ removed });
}
