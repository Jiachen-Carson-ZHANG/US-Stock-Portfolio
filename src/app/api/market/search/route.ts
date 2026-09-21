import { searchSchema } from "@/lib/schemas";
import { requirePortfolioApi } from "@/lib/portfolios/context";
import { portfolioSlugFrom } from "@/lib/portfolios/request";
import { getMarketDataProvider } from "@/providers";

/**
 * moomoo's own search endpoint covers news and community posts, not symbol
 * lookup, so a ticker is resolved by asking for its quote: if one comes back,
 * the ticker is real and carries its name and price.
 */
export async function GET(request: Request) {
  // Quotes are not portfolio data, but fetching them spends a broker token,
  // so the request still says whose. Defaults to the viewer's own.
  const context = await requirePortfolioApi(portfolioSlugFrom(request));
  if ("response" in context) return context.response;

  const parsed = searchSchema.safeParse({
    q: new URL(request.url).searchParams.get("q") ?? "",
  });
  if (!parsed.success) {
    return Response.json({ error: "Invalid query" }, { status: 400 });
  }

  const symbol = parsed.data.q.toUpperCase();

  try {
    const quotes = await (
      await getMarketDataProvider(context.portfolio.id)
    ).getQuotes([symbol]);
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
