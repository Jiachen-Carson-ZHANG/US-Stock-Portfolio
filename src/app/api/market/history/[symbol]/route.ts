import { authenticateRequest, unauthorized } from "@/lib/auth/guards";
import { historyRangeSchema, symbolSchema } from "@/lib/schemas";
import { getMarketDataProvider } from "@/providers";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ symbol: string }> },
) {
  const user = await authenticateRequest();
  if (!user) return unauthorized();

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

  const prices = await (await getMarketDataProvider()).getHistoricalPrices(
    parsedSymbol.data,
    { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) },
  );

  return Response.json({ symbol: parsedSymbol.data, prices });
}
