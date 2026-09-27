import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";
import { loadExpirations, loadPricedChain, NoOptionsError } from "@/lib/options/chain-server";
import { requirePortfolioApi } from "@/lib/portfolios/context";
import { portfolioSlugFrom } from "@/lib/portfolios/request";
import { optionScreenSchema } from "@/lib/schemas";
import { getMarketDataProvider } from "@/providers";

export const maxDuration = 60;

/**
 * The option chain, the way moomoo shows it: one expiry, the strikes around
 * the share price, and for each the call and the put with their prices.
 * Without an expiry, the share's price and the expiries to choose from.
 */
export async function GET(request: Request) {
  const context = await requirePortfolioApi(portfolioSlugFrom(request));
  if ("response" in context) return context.response;

  const url = new URL(request.url);
  const parsed = optionScreenSchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }
  const { symbol, expiry, strikes, min, max } = parsed.data;

  const db = await getDb();
  const provider = await getMarketDataProvider(context.portfolio.id);
  const now = new Date();

  try {
    const { spot, expirations } = await loadExpirations(db, provider, symbol, now);
    if (spot === null) {
      return Response.json(
        { error: `Couldn't find ${symbol}. Options here cover shares and funds listed in the US.` },
        { status: 404 },
      );
    }
    if (!expiry) return Response.json({ symbol, spot, expirations });
    if (!expirations.some((row) => row.date === expiry)) {
      return Response.json({ error: "That expiry is not listed." }, { status: 400 });
    }

    const { contracts, priced } = await loadPricedChain(db, provider, symbol, expiry, spot, now, {
      nearest: strikes ?? 20,
      min,
      max,
    });
    return Response.json({ symbol, spot, expirations, expiry, contracts, chain: priced });
  } catch (error) {
    if (error instanceof NoOptionsError) {
      return Response.json({ error: error.message }, { status: 501 });
    }
    logger.error("options.chain.failure", {
      symbol,
      expiry: expiry ?? "",
      reason: error instanceof Error ? error.message : "unknown",
    });
    return Response.json(
      { error: "The broker did not answer with the option chain. Try again in a moment." },
      { status: 502 },
    );
  }
}
