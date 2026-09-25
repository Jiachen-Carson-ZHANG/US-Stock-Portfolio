import { getDb } from "@/lib/db";
import { requirePortfolioApi } from "@/lib/portfolios/context";
import { portfolioSlugFrom } from "@/lib/portfolios/request";
import { quotesQuerySchema } from "@/lib/schemas";
import { getQuotes } from "@/lib/portfolio/quotes";
import { getMarketDataProvider } from "@/providers";
import { marketSession } from "@/lib/market-hours";

export async function GET(request: Request) {
  // Quotes are not portfolio data, but fetching them spends a broker token,
  // so the request still says whose. Leaving it out is refused, not guessed.
  const context = await requirePortfolioApi(portfolioSlugFrom(request));
  if ("response" in context) return context.response;

  const url = new URL(request.url);
  const parsed = quotesQuerySchema.safeParse({
    symbols: url.searchParams.get("symbols") ?? "",
  });
  if (!parsed.success) {
    return Response.json({ error: "Invalid symbols" }, { status: 400 });
  }

  const { quotes, isStale, dataTimestamp } = await getQuotes(
    await getDb(),
    parsed.data.symbols,
    await getMarketDataProvider(context.portfolio.id),
  );

  return Response.json({
    quotes: [...quotes.values()],
    marketStatus: marketSession(),
    dataTimestamp,
    isStale,
  });
}
