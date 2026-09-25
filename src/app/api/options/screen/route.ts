import { getDb } from "@/lib/db";
import { cachedSeries } from "@/lib/analysis/series-cache";
import { yearsUntil } from "@/lib/analysis/options-pricing";
import { logger } from "@/lib/logger";
import { candidates, rankingFor, type ChainQuote } from "@/lib/options/strategies";
import { getQuotes } from "@/lib/portfolio/quotes";
import { requirePortfolioApi } from "@/lib/portfolios/context";
import { portfolioSlugFrom } from "@/lib/portfolios/request";
import { optionScreenSchema } from "@/lib/schemas";
import { getMarketDataProvider } from "@/providers";
import type { OptionContract, OptionExpiration } from "@/types/market";

export const maxDuration = 60;

/** Contracts priced per request: the ones nearest the share price. */
const PRICED = 120;

function number(value: unknown): number | undefined {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * The option finder.
 *
 * Without an expiry: the share's price and the expiries listed for it.
 * With an expiry and a strategy: the contracts on that expiry, priced from
 * the same snapshot as every other price here, turned into ranked
 * candidates (see lib/options/strategies).
 *
 * The listed expiries and the chain itself change slowly, so they are kept
 * for hours; prices go through the ordinary ten-second quote cache. A
 * request names the portfolio only because a price is fetched with somebody's
 * broker connection.
 */
export async function GET(request: Request) {
  const context = await requirePortfolioApi(portfolioSlugFrom(request));
  if ("response" in context) return context.response;

  const url = new URL(request.url);
  const parsed = optionScreenSchema.safeParse({
    symbol: url.searchParams.get("symbol") ?? "",
    expiry: url.searchParams.get("expiry") ?? undefined,
    strategy: url.searchParams.get("strategy") ?? undefined,
    sure: url.searchParams.get("sure") ?? undefined,
  });
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0]?.message ?? "Invalid request" }, { status: 400 });
  }
  const { symbol, expiry, strategy, sure } = parsed.data;

  const provider = await getMarketDataProvider(context.portfolio.id);
  if (!provider.getOptionExpirations || !provider.getOptionChain) {
    return Response.json({ error: "Option chains need a broker connection." }, { status: 501 });
  }
  const listExpirations = provider.getOptionExpirations.bind(provider);
  const listChain = provider.getOptionChain.bind(provider);

  const db = await getDb();
  const now = new Date();

  try {
    const { quotes: underlying } = await getQuotes(db, [symbol], provider, now);
    const spot = underlying.get(symbol)?.price;
    if (!spot) {
      return Response.json({ error: `No price for ${symbol} right now.` }, { status: 404 });
    }

    const expirations = await cachedSeries<OptionExpiration[]>(
      `options:expirations:${symbol}`,
      6 * 3_600_000,
      () => listExpirations(symbol),
    );
    if (!expiry || !strategy) {
      return Response.json({ symbol, spot, expirations });
    }
    if (!expirations.some((row) => row.date === expiry)) {
      return Response.json({ error: "That expiry is not listed." }, { status: 400 });
    }

    const chain = await cachedSeries<OptionContract[]>(
      `options:chain:${symbol}:${expiry}`,
      3_600_000,
      () => listChain(symbol, expiry),
    );

    // Near the money only: a strike half the share price away is nobody's
    // candidate, and pricing it costs the same as pricing a useful one.
    const near = chain
      .filter((contract) => contract.strike >= spot * 0.6 && contract.strike <= spot * 1.4)
      .sort((a, b) => Math.abs(a.strike - spot) - Math.abs(b.strike - spot))
      .slice(0, PRICED);
    const { quotes } = await getQuotes(
      db,
      near.map((contract) => contract.symbol),
      provider,
      now,
      { waitForFresh: true },
    );

    const priced: ChainQuote[] = near.flatMap((contract) => {
      const quote = quotes.get(contract.symbol);
      if (!quote) return [];
      const raw = quote.raw ?? {};
      return [
        {
          symbol: contract.symbol,
          type: contract.type,
          strike: contract.strike,
          bid: number(raw.bid_price),
          ask: number(raw.ask_price),
          iv: quote.greeks?.impliedVolatility,
          delta: quote.greeks?.delta,
          openInterest: quote.greeks?.openInterest,
          volume: number(raw.volume),
          multiplier: contract.multiplier,
        },
      ];
    });

    return Response.json({
      symbol,
      spot,
      expirations,
      expiry,
      strategy,
      ranking: rankingFor(strategy),
      contracts: chain.length,
      priced: priced.length,
      candidates: candidates(strategy, priced, spot, yearsUntil(expiry, now), 8, sure ?? 0.7),
    });
  } catch (error) {
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
