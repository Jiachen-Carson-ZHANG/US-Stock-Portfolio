import { recordActivity } from "@/lib/activity";
import { getDb } from "@/lib/db";
import { requirePortfolioApi, requireWritable } from "@/lib/portfolios/context";
import { portfolioSlugFrom } from "@/lib/portfolios/request";
import { logger } from "@/lib/logger";
import { clearTokenCache } from "@/lib/moomoo/client";
import { deleteConnection } from "@/lib/moomoo/tokens";

// Revoking is deliberately available to whoever owns the portfolio, not only
// to an administrator: the person whose brokerage it is must be able to cut
// the link themselves, from their own page, without asking anyone.
export async function POST(request: Request) {
  const context = await requirePortfolioApi(portfolioSlugFrom(request));
  if ("response" in context) return context.response;
  const denied = requireWritable(context);
  if (denied) return denied.response;

  const db = await getDb();
  // Awaited: dropping the connection is the whole point of the request, and a
  // floating promise can be discarded once the response has gone out.
  await deleteConnection(db, context.portfolio.id);
  clearTokenCache(context.portfolio.id);
  await recordActivity(db, {
    userId: context.user.id,
    username: context.user.username,
    kind: "broker_disconnect",
    detail: "moomoo",
  });
  logger.info("broker.disconnected", { provider: "moomoo" });

  return Response.json({ ok: true });
}
