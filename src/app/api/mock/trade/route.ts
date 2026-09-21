import { recordActivity } from "@/lib/activity";
import { getDb } from "@/lib/db";
import { rejectCrossOrigin } from "@/lib/http/origin";
import { logger } from "@/lib/logger";
import { MockTradeError, placeMockTrade } from "@/lib/portfolio/mock";
import { requirePortfolioApi, requireWritable } from "@/lib/portfolios/context";
import { portfolioSlugFrom } from "@/lib/portfolios/request";
import { mockTradeSchema } from "@/lib/schemas";
import { getMarketDataProvider } from "@/providers";

/**
 * Places a trade in a mock portfolio.
 *
 * Only in your own: watching someone else's account does not let you trade
 * in it, and being an administrator does not either.
 */
export async function POST(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;

  const context = await requirePortfolioApi(portfolioSlugFrom(request));
  if ("response" in context) return context.response;
  const denied = requireWritable(context);
  if (denied) return denied.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = mockTradeSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid trade" },
      { status: 400 },
    );
  }

  const symbol = parsed.data.symbol.toUpperCase();

  try {
    const provider = await getMarketDataProvider(context.portfolio.id);
    const quote = (await provider.getQuotes([symbol])).find((q) => q.symbol === symbol);

    const db = await getDb();
    const result = await placeMockTrade(
      db,
      context.portfolio,
      { side: parsed.data.side, symbol, quantity: parsed.data.quantity },
      quote,
    );

    await recordActivity(db, {
      userId: context.user.id,
      username: context.user.username,
      kind: "mock_trade",
      target: symbol,
      detail: `${parsed.data.side} ${parsed.data.quantity} at ${result.price}`,
    });

    return Response.json({ ...result, symbol });
  } catch (error) {
    if (error instanceof MockTradeError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    logger.error("paper.trade.failure", {
      reason: error instanceof Error ? error.message : "unknown",
    });
    return Response.json({ error: "Could not place the trade." }, { status: 502 });
  }
}
