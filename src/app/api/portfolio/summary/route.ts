import { loadPortfolio } from "@/lib/portfolio/service";
import { requirePortfolioApi } from "@/lib/portfolios/context";
import { portfolioSlugFrom } from "@/lib/portfolios/request";

export async function GET(request: Request) {
  const context = await requirePortfolioApi(portfolioSlugFrom(request));
  if ("response" in context) return context.response;

  const { summary, concentration } = await loadPortfolio(context.portfolio.id);
  return Response.json({ summary, concentration });
}
