import { authenticateRequest, unauthorized } from "@/lib/auth/guards";
import { searchSchema } from "@/lib/schemas";
import { getMarketDataProvider } from "@/providers";

/**
 * moomoo's own search endpoint covers news and community posts, not symbol
 * lookup, so a ticker is resolved by asking for its quote: if one comes back,
 * the ticker is real and carries its name and price.
 */
export async function GET(request: Request) {
  const user = await authenticateRequest();
  if (!user) return unauthorized();

  const parsed = searchSchema.safeParse({
    q: new URL(request.url).searchParams.get("q") ?? "",
  });
  if (!parsed.success) {
    return Response.json({ error: "Invalid query" }, { status: 400 });
  }

  const symbol = parsed.data.q.toUpperCase();

  try {
    const quotes = await getMarketDataProvider().getQuotes([symbol]);
    return Response.json({
      results: quotes.map((quote) => ({
        symbol: quote.symbol,
        name: quote.name ?? quote.symbol,
        price: quote.price,
        changePercent: quote.changePercent,
      })),
    });
  } catch {
    return Response.json({ results: [] });
  }
}
