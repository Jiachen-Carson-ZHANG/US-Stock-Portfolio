import { authenticateRequest, unauthorized } from "@/lib/auth/guards";
import { getDb } from "@/lib/db";
import { quotesQuerySchema } from "@/lib/schemas";
import { getQuotes } from "@/lib/portfolio/quotes";
import { getMarketDataProvider } from "@/providers";
import { marketSession } from "@/lib/market-hours";

export async function GET(request: Request) {
  const user = await authenticateRequest();
  if (!user) return unauthorized();

  const url = new URL(request.url);
  const parsed = quotesQuerySchema.safeParse({
    symbols: url.searchParams.get("symbols") ?? "",
  });
  if (!parsed.success) {
    return Response.json({ error: "Invalid symbols" }, { status: 400 });
  }

  const { quotes, isStale, dataTimestamp } = await getQuotes(
    getDb(),
    parsed.data.symbols,
    getMarketDataProvider(),
  );

  return Response.json({
    quotes: [...quotes.values()],
    marketStatus: marketSession(),
    dataTimestamp,
    isStale,
  });
}
