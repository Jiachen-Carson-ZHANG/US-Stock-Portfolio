import { loadPortfolio } from "@/lib/portfolio/service";
import { requirePortfolioApi } from "@/lib/portfolios/context";
import { portfolioSlugFrom } from "@/lib/portfolios/request";

/**
 * Long enough to survive the database waking from suspend, which has been
 * measured at 26 seconds. Without this the platform's default cut the render
 * short and the reader got an error page instead of one slow load.
 */
export const maxDuration = 60;


export async function GET(request: Request) {
  const context = await requirePortfolioApi(portfolioSlugFrom(request));
  if ("response" in context) return context.response;

  const {
    positions,
    allocations,
    summary,
    totalInvested,
    optionGroups,
    concentration,
    realizedBySymbol,
  } = await loadPortfolio(context.portfolio.id);
  return Response.json({
    positions,
    concentration,
    allocations,
    summary,
    totalInvested,
    optionGroups,
    realizedBySymbol,
  });
}
