import { getCurrentUser, unauthorized } from "@/lib/auth/guards";
import { getDb } from "@/lib/db";
import { rejectCrossOrigin } from "@/lib/http/origin";
import { getQuotes } from "@/lib/portfolio/quotes";
import { defaultFor } from "@/lib/portfolios";
import { getMarketDataProvider } from "@/providers";
import { unwatch, watch } from "@/lib/watch";

export const dynamic = "force-dynamic";

const SYMBOL = /^[A-Z][A-Z0-9.\-]{0,23}$/;

/**
 * Adding a name to your own list.
 *
 * The symbol is checked against the broker before it is kept. A watchlist
 * full of typos is a list of empty rows, and the broker is the only thing that
 * can say whether a ticker is real.
 */
export async function POST(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;

  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body = await request.json().catch(() => ({}));
  const symbol = typeof body?.symbol === "string" ? body.symbol.trim().toUpperCase() : "";
  if (!SYMBOL.test(symbol)) {
    return Response.json({ error: "That does not look like a ticker." }, { status: 400 });
  }

  const db = await getDb();
  const home = await defaultFor(db, user);
  const provider = await getMarketDataProvider(home?.id ?? "");
  const { quotes } = await getQuotes(db, [symbol], provider, new Date());
  if (!quotes.has(symbol)) {
    return Response.json(
      { error: `${symbol} is not a symbol the broker recognises.` },
      { status: 404 },
    );
  }

  await watch(db, user.id, symbol);
  return Response.json({ ok: true, symbol });
}

export async function DELETE(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;

  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body = await request.json().catch(() => ({}));
  const symbol = typeof body?.symbol === "string" ? body.symbol.trim().toUpperCase() : "";
  if (!symbol) return Response.json({ error: "Invalid request" }, { status: 400 });

  await unwatch(await getDb(), user.id, symbol);
  return Response.json({ ok: true });
}
