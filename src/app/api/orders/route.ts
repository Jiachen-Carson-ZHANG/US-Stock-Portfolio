import { recordActivity } from "@/lib/activity";
import { getDb } from "@/lib/db";
import { rejectCrossOrigin } from "@/lib/http/origin";
import { logger } from "@/lib/logger";
import {
  OrderError,
  buyingPower,
  cancelOrder,
  placeOrder,
  recentOrders,
} from "@/lib/trading/orders";
import { requirePortfolioApi, requireWritable } from "@/lib/portfolios/context";
import { portfolioSlugFrom } from "@/lib/portfolios/request";
import { cancelOrderSchema, placeOrderSchema } from "@/lib/schemas";
import { getMarketDataProvider } from "@/providers";

/** The ticket: what is resting, what has happened, and what can be spent. */
export async function GET(request: Request) {
  const context = await requirePortfolioApi(portfolioSlugFrom(request));
  if ("response" in context) return context.response;

  const db = await getDb();
  const [orders, power] = await Promise.all([
    recentOrders(db, context.portfolio.id),
    context.portfolio.kind === "mock"
      ? buyingPower(db, context.portfolio)
      : Promise.resolve(null),
  ]);

  return Response.json({
    orders,
    buyingPower: power === null ? null : power.toFixed(2),
  });
}

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

  const parsed = placeOrderSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid order" },
      { status: 400 },
    );
  }

  const symbol = parsed.data.symbol.toUpperCase();

  try {
    const provider = await getMarketDataProvider(context.portfolio.id);
    const quote = (await provider.getQuotes([symbol])).find((q) => q.symbol === symbol);

    const db = await getDb();
    const result = await placeOrder(
      db,
      context.portfolio,
      { ...parsed.data, symbol },
      quote,
      context.user.id,
    );

    await recordActivity(db, {
      userId: context.user.id,
      username: context.user.username,
      kind: "mock_trade",
      target: symbol,
      detail: `${parsed.data.side} ${parsed.data.quantity} ${parsed.data.kind}${
        result.filled ? ` filled at ${result.order.fillPrice}` : " resting"
      }`,
    });

    return Response.json({
      order: result.order,
      filled: result.filled,
      buyingPower: (await buyingPower(db, context.portfolio)).toFixed(2),
    });
  } catch (error) {
    if (error instanceof OrderError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    logger.error("order.place.failure", {
      reason: error instanceof Error ? error.message : "unknown",
    });
    return Response.json({ error: "Could not place the order." }, { status: 502 });
  }
}

export async function DELETE(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;

  const context = await requirePortfolioApi(portfolioSlugFrom(request));
  if ("response" in context) return context.response;
  const denied = requireWritable(context);
  if (denied) return denied.response;

  const body = await request.json().catch(() => ({}));
  const parsed = cancelOrderSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const db = await getDb();
  const cancelled = await cancelOrder(db, context.portfolio.id, parsed.data.orderId);
  if (!cancelled) {
    return Response.json({ error: "That order is no longer open." }, { status: 409 });
  }

  return Response.json({
    ok: true,
    buyingPower: (await buyingPower(db, context.portfolio)).toFixed(2),
  });
}
