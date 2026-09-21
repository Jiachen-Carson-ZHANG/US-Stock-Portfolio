import { rejectCrossOrigin } from "@/lib/http/origin";
import { logger } from "@/lib/logger";
import { requirePortfolioApi, requireWritable } from "@/lib/portfolios/context";
import { portfolioSlugFrom } from "@/lib/portfolios/request";
import { authorizeUrl, createPkcePair, createState } from "@/lib/moomoo/oauth";
import { redirectUri, storePendingFlow } from "@/lib/moomoo/flow";

export async function POST(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;
  // Connecting a broker is a write against your own portfolio. Anyone may do
  // it for theirs; nobody may do it for somebody else's.
  const context = await requirePortfolioApi(portfolioSlugFrom(request));
  if ("response" in context) return context.response;
  if (context.portfolio.kind !== "broker") return Response.json({ error: "Mock accounts cannot connect a broker" }, { status: 400 });
  const denied = requireWritable(context);
  if (denied) return denied.response;

  const clientId = process.env.MOOMOO_CLIENT_ID;
  if (!clientId) {
    return Response.json(
      { error: "MOOMOO_CLIENT_ID is not configured. Run: npm run moomoo:register" },
      { status: 500 },
    );
  }

  const { verifier, challenge } = createPkcePair();
  const state = createState();
  await storePendingFlow({ state, verifier, portfolioId: context.portfolio.id });

  logger.info("broker.connect.started", {
    provider: "moomoo",
    portfolio: context.portfolio.slug,
  });

  return Response.json({
    authorizeUrl: authorizeUrl({
      clientId,
      challenge,
      redirectUri: redirectUri(),
      state,
    }),
  });
}
