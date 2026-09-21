import { rejectCrossOrigin } from "@/lib/http/origin";
import { authenticateRequest, unauthorized } from "@/lib/auth/guards";
import { getDb } from "@/lib/db";
import { requirePortfolioApi } from "@/lib/portfolios/context";
import { portfolioSlugFrom } from "@/lib/portfolios/request";
import {
  familyAction,
  familyActionSchema,
  readFamily,
} from "@/lib/family/repository";
import { getMarketDataProvider, activeProvider } from "@/providers";
import type { Quote } from "@/types/market";
export async function GET() {
  const user = await authenticateRequest();
  if (!user) return unauthorized();
  return Response.json(await readFamily(await getDb(), user), {
    headers: { "Cache-Control": "no-store" },
  });
}
export async function POST(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;
  // The challenge prices against whichever portfolio the player is viewing
  // from; its only role here is deciding whose broker token fetches a quote.
  const context = await requirePortfolioApi(portfolioSlugFrom(request));
  if ("response" in context) return context.response;
  const user = context.user;
  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }
  const parsed = familyActionSchema.safeParse(input);
  if (!parsed.success)
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid action" },
      { status: 400 },
    );
  try {
    let quote: Quote | undefined;
    let quotes: Quote[] = [];
    const db = await getDb();
    const mode = (await activeProvider(context.portfolio.id)) === "mock" ? "demo" : "live";
    if (parsed.data.action === "trade" || parsed.data.action === "mark") {
      const challenge = (await readFamily(db, user)).challenge;
      if (challenge && challenge.mode !== mode)
        return Response.json(
          {
            error:
              "This challenge uses a different price source. Start a new challenge after it ends.",
          },
          { status: 409 },
        );
      if (parsed.data.action === "trade") {
        const symbol = parsed.data.symbol;
        quote = (
          await (await getMarketDataProvider(context.portfolio.id)).getQuotes([symbol])
        ).find(
          (q) => q.symbol === symbol,
        );
        if (!quote)
          return Response.json(
            { error: "Quote unavailable." },
            { status: 409 },
          );
      } else {
        const symbols = [
          ...new Set(
            challenge?.members.flatMap((m) =>
              Object.keys(m.holdings).filter((s) => m.holdings[s] > 0),
            ) ?? [],
          ),
        ];
        if (symbols.length)
          quotes = await (
            await getMarketDataProvider(context.portfolio.id)
          ).getQuotes(symbols);
      }
    }
    return Response.json(
      await familyAction(db, user, parsed.data, new Date(), quote, quotes, mode),
    );
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to save. Please try again.",
      },
      { status: 400 },
    );
  }
}
