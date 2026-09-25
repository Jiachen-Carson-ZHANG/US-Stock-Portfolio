import { rejectCrossOrigin } from "@/lib/http/origin";
import { requirePortfolioApi } from "@/lib/portfolios/context";
import { rememberViewing } from "@/lib/portfolios/last-viewed";
import { portfolioSlugFrom } from "@/lib/portfolios/request";

/**
 * Records which portfolio somebody opened, so pages without one in their
 * address (the playground, the watchlist, the site root) keep them on it.
 *
 * This is a route of its own because a page cannot set a cookie while it
 * renders — Next forbids it, and the attempt fails silently. The [portfolio]
 * layout calls this instead whenever the portfolio in the address changes.
 *
 * Access is checked before remembering, and again on every read of the
 * cookie: it records a preference, never a permission.
 */
export async function POST(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;
  const context = await requirePortfolioApi(portfolioSlugFrom(request));
  if ("response" in context) return context.response;

  await rememberViewing(context.portfolio.slug);
  return new Response(null, { status: 204 });
}
