import { historyRangeSchema } from "@/lib/schemas";
import { loadHistory } from "@/lib/portfolio/service";
import { requirePortfolioApi } from "@/lib/portfolios/context";
import { portfolioSlugFrom } from "@/lib/portfolios/request";

export async function GET(request: Request) {
  const context = await requirePortfolioApi(portfolioSlugFrom(request));
  if ("response" in context) return context.response;

  const url = new URL(request.url);
  const parsed = historyRangeSchema.safeParse({
    days: url.searchParams.get("days") ?? undefined,
  });
  if (!parsed.success) {
    return Response.json({ error: "Invalid range" }, { status: 400 });
  }

  const cutoff = new Date(Date.now() - parsed.data.days * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const snapshots = (await loadHistory(context.portfolio.id)).filter(
    (s) => s.snapshotDate >= cutoff,
  );
  return Response.json({ snapshots });
}
