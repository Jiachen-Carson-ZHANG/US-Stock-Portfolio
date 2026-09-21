import { symbolSchema } from "@/lib/schemas";
import { loadPosition } from "@/lib/portfolio/service";
import { requirePortfolioApi } from "@/lib/portfolios/context";
import { portfolioSlugFrom } from "@/lib/portfolios/request";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ symbol: string }> },
) {
  const context = await requirePortfolioApi(portfolioSlugFrom(request));
  if ("response" in context) return context.response;

  const parsed = symbolSchema.safeParse((await params).symbol);
  if (!parsed.success) {
    return Response.json({ error: "Invalid symbol" }, { status: 400 });
  }

  const position = await loadPosition(context.portfolio.id, parsed.data);
  if (!position) return Response.json({ error: "Not found" }, { status: 404 });

  return Response.json({ position });
}
