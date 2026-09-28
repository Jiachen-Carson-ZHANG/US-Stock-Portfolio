import { getDb } from "@/lib/db";
import { yearsUntil } from "@/lib/analysis/options-pricing";
import { logger } from "@/lib/logger";
import { loadExpirations, loadPricedChain, NoOptionsError } from "@/lib/options/chain-server";
import { candidates, defaultSure, rankingFor } from "@/lib/options/strategies";
import { screenAll } from "@/lib/options/screen";
import { requirePortfolioApi } from "@/lib/portfolios/context";
import { portfolioSlugFrom } from "@/lib/portfolios/request";
import { optionScreenSchema } from "@/lib/schemas";
import { getMarketDataProvider } from "@/providers";

export const maxDuration = 60;

/**
 * The strategy finder.
 *
 * Without an expiry, the share's price and the expiries listed for it. With
 * "all", every expiry within the horizon searched and ranked together (see
 * lib/options/screen). With one expiry and a strategy, that expiry's
 * contracts near the share price, or inside the strike range asked for,
 * priced and turned into ranked candidates (see lib/options/strategies). A request names the
 * portfolio only because a price is fetched with somebody's connection.
 */
export async function GET(request: Request) {
  const context = await requirePortfolioApi(portfolioSlugFrom(request));
  if ("response" in context) return context.response;

  const url = new URL(request.url);
  const parsed = optionScreenSchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }
  const { symbol, expiry, strategy, sure, min, max, days, sort } = parsed.data;

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
    if (!expiry || !strategy) return Response.json({ symbol, spot, expirations });

    // Every expiry within the horizon, ranked together.
    if (expiry === "all") {
      const result = await screenAll(db, provider, {
        symbol,
        spot,
        expirations,
        strategy,
        horizonDays: days ?? 60,
        minChance: sure ?? defaultSure(strategy),
        sort: sort ?? "best",
        min,
        max,
        now,
      });
      return Response.json({ symbol, spot, strategy, ...result });
    }

    if (!expirations.some((row) => row.date === expiry)) {
      return Response.json({ error: "That expiry is not listed." }, { status: 400 });
    }

    const { contracts, priced } = await loadPricedChain(db, provider, symbol, expiry, spot, now, {
      nearest: min !== undefined || max !== undefined ? 80 : 40,
      min,
      max,
    });

    return Response.json({
      symbol,
      spot,
      expirations,
      expiry,
      strategy,
      ranking: rankingFor(strategy),
      contracts,
      priced: priced.length,
      candidates: candidates(strategy, priced, spot, yearsUntil(expiry, now), 8, sure ?? 0.7),
    });
  } catch (error) {
    if (error instanceof NoOptionsError) {
      return Response.json({ error: error.message }, { status: 501 });
    }
    const reason = error instanceof Error ? error.message : "unknown";
    logger.error("options.screen.failure", { symbol, expiry: expiry ?? "", reason });
    return Response.json(
      {
        error: "The broker did not answer with the option chain. Try again in a moment.",
        reason: /permission|denied|scope/i.test(reason)
          ? "The broker connection does not include option data."
          : undefined,
      },
      { status: 502 },
    );
  }
}
