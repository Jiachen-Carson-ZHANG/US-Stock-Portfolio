import { cachedSeries } from "@/lib/analysis/series-cache";
import { chartWindow, lastSessions } from "@/lib/market/chart-range";
import { chartRangeSchema, historyRangeSchema, symbolSchema } from "@/lib/schemas";
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
  const provider = await getMarketDataProvider(context.portfolio.id);

  // A chart view: candles sized to the range.
  const chart = url.searchParams.get("range");
  if (chart !== null) {
    const parsedChart = chartRangeSchema.safeParse(chart);
    if (!parsedChart.success) {
      return Response.json({ error: "Invalid range" }, { status: 400 });
    }
    const window = chartWindow(parsedChart.data, new Date());
    const load = () =>
      provider.getHistoricalPrices(parsedSymbol.data, window, { interval: window.interval });
    try {
      // Intraday candles are fetched fresh; a day's or a month's are kept
      // for a while, since the only one still moving is the last.
      const bars =
        window.sessions !== undefined
          ? lastSessions(await load(), window.sessions)
          : await cachedSeries(
              `chart:${parsedSymbol.data}:${parsedChart.data}`,
              parsedChart.data === "MAX" ? 12 * 3_600_000 : 600_000,
              load,
            );
      return Response.json({ symbol: parsedSymbol.data, range: parsedChart.data, interval: window.interval, bars });
    } catch {
      return Response.json(
        { error: "The broker did not send the price history. Try again in a moment." },
        { status: 502 },
      );
    }
  }

  const parsedRange = historyRangeSchema.safeParse({
    days: url.searchParams.get("days") ?? undefined,
  });
  if (!parsedRange.success) {
    return Response.json({ error: "Invalid range" }, { status: 400 });
  }

  const to = new Date();
  const from = new Date(to.getTime() - parsedRange.data.days * 86_400_000);

  const prices = await provider.getHistoricalPrices(
    parsedSymbol.data,
    { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
  );

  return Response.json({ symbol: parsedSymbol.data, prices });
}
