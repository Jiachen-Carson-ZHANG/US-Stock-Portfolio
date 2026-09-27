import { rejectCrossOrigin } from "@/lib/http/origin";
import { recordActivity } from "@/lib/activity";
import { getDb } from "@/lib/db";
import { requirePortfolioApi } from "@/lib/portfolios/context";
import { portfolioSlugFrom } from "@/lib/portfolios/request";
import { logger } from "@/lib/logger";
import { syncPositions } from "@/lib/portfolio/sync";
import { activeProvider, getBrokerProvider, hasBrokerConnection } from "@/providers";

export async function POST(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;
  const context = await requirePortfolioApi(portfolioSlugFrom(request));
  if ("response" in context) return context.response;
  // Broker synchronization reads upstream data; every authorized reader may request it.

  const portfolioId = context.portfolio.id;
  // A real account with no connection has nothing to pull — and must never
  // be filled from the demo feed instead, which is what the provider falls
  // back to when nothing is connected.
  if (context.portfolio.kind === "broker" && !(await hasBrokerConnection(portfolioId))) {
    return Response.json(
      { error: "Connect moomoo to this account first." },
      { status: 409 },
    );
  }
  const provider = await activeProvider(portfolioId);
  const db = await getDb();

  try {
    const count = await syncPositions(
      db,
      portfolioId,
      await getBrokerProvider(portfolioId),
      provider === "moomoo" ? "moomoo" : "mock",
    );
    await recordActivity(db, {
      userId: context.user.id,
      username: context.user.username,
      kind: "sync",
      detail: `${count} positions from ${provider}`,
    });
    logger.info("broker.sync.success", { provider, positions: count });
    return Response.json({ synced: count, provider });
  } catch (error) {
    logger.error("broker.sync.failure", {
      provider,
      reason: error instanceof Error ? error.message : "unknown",
    });
    return Response.json(
      { error: "Synchronization failed. Portfolio left unchanged." },
      { status: 502 },
    );
  }
}
