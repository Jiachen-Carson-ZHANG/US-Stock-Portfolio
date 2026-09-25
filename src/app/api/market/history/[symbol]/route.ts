import { historyRangeSchema, symbolSchema } from "@/lib/schemas";
import { requirePortfolioApi } from "@/lib/portfolios/context";
import { portfolioSlugFrom } from "@/lib/portfolios/request";
import { getMarketDataProvider } from "@/providers";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ symbol: string }> },
) {
  // Quotes are not portfolio data, but fetching them spends a broker token,
  // so the request still says whose. Leaving it out is refused, not guessed.
  const context = await requirePortfolioApi(portfolioSlugFrom(request));
  if ("response" in context) return context.response;

  const parsedSymbol = symbolSchema.safeParse((await params).symbol);
  if (!parsedSymbol.success) {
    return Response.json({ error: "Invalid symbol" }, { status: 400 });
  }

  const url = new URL(request.url);
  const parsedRange = historyRangeSchema.safeParse({
    days: url.searchParams.get("days") ?? undefined,
  });
  if (!parsedRange.success) {
    return Response.json({ error: "Invalid range" }, { status: 400 });
  }

  const to = new Date();
  const from = new Date(to.getTime() - parsedRange.data.days * 86_400_000);

  const prices = await (
    await getMarketDataProvider(context.portfolio.id)
  ).getHistoricalPrices(
    parsedSymbol.data,
    { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
  );

  return Response.json({ symbol: parsedSymbol.data, prices });
}
