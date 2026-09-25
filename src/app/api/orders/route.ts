import { recordActivity } from "@/lib/activity";
import { getDb } from "@/lib/db";
import { notifyFollowers } from "@/lib/feed";
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
import { ensureFreshPositions } from "@/lib/portfolio/service";
import { getQuotes } from "@/lib/portfolio/quotes";
import { getMarketDataProvider } from "@/providers";

/** The ticket: what is resting, what has happened, and what can be spent. */
export async function GET(request: Request) {
  const context = await requirePortfolioApi(portfolioSlugFrom(request));
  if ("response" in context) return context.response;

  // The trade screen polls this every few seconds while something is resting,
  // so this is also where those orders get priced and filled for whoever is
  // watching. The scheduler does the same for everyone who is not.
  if (context.portfolio.kind === "mock") {
    await ensureFreshPositions(context.portfolio.id, new Date()).catch(() => {});
  }

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

  const db = await getDb();

  try {
    // Through the shared cache, like every other price on the site. Asking the
    // provider directly meant an order was priced from a different request
    // than the one the screen had just shown, and a feed that was failing
    // showed a healthy price from cache while every order died.
    //
    // Waiting for a fresh one, though, rather than taking whatever is cached:
    // an order that fills on the spot fills at this price, and a cached one
    // can be seconds behind a market the person clicking is watching live.
    const provider = await getMarketDataProvider(context.portfolio.id);
    const { quotes } = await getQuotes(db, [symbol], provider, new Date(), {
      waitForFresh: true,
    });
    const quote = quotes.get(symbol);
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

    // Only reaches followers who could already open this portfolio. Following
    // somebody is not a way past the access rule, and it is checked when the
    // message is sent rather than when it is read.
    await notifyFollowers(db, {
      subjectId: context.user.id,
      kind: "feed_trade",
      title: `${context.user.displayName} ${
        result.filled
          ? parsed.data.side === "buy"
            ? "bought"
            : "sold"
          : "placed an order for"
      } ${symbol}`,
      body: `${parsed.data.side} ${parsed.data.quantity}${
        result.filled ? ` · filled at ${result.order.fillPrice}` : " · resting"
      }`,
      link: `/${context.portfolio.slug}`,
      portfolioId: context.portfolio.id,
    }).catch(() => {});

    return Response.json({
      order: result.order,
      filled: result.filled,
      buyingPower: (await buyingPower(db, context.portfolio)).toFixed(2),
    });
  } catch (error) {
    if (error instanceof OrderError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    const reason = error instanceof Error ? error.message : "unknown";
    logger.error("order.place.failure", { reason });
    return Response.json(
      {
        error: "Could not place the order.",
        // The category, not the stack trace. "Could not place the order" on
        // its own left nobody anything to act on — the price feed being down
        // and the account being wrong are different problems with different
        // answers, and the person looking at the screen deserves to know
        // which one they have.
        reason: /quote|price|snapshot/i.test(reason)
          ? "The price feed did not answer. Try again in a moment."
          : /token|auth|connect/i.test(reason)
            ? "The broker connection needs renewing before prices can be fetched."
            : "Something went wrong on our side. It has been logged.",
      },
      { status: 502 },
    );
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
