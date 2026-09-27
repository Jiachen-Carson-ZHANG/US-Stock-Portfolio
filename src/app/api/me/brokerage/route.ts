import { recordActivity } from "@/lib/activity";
import { getCurrentUser, unauthorized } from "@/lib/auth/guards";
import { getDb } from "@/lib/db";
import { rejectCrossOrigin } from "@/lib/http/origin";
import { logger } from "@/lib/logger";
import { ensureOwnBrokerPortfolio } from "@/lib/portfolios";

/**
 * Makes — or finds — the caller's own real account, ready to connect.
 *
 * Always the caller's: there is nothing in the request to say whose, so
 * there is nothing to forge. Calling it twice returns the same account.
 */
export async function POST(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const db = await getDb();
  const { portfolio, created } = await ensureOwnBrokerPortfolio(db, user);
  if (created) {
    await recordActivity(db, {
      userId: user.id,
      username: user.username,
      kind: "portfolio_create",
      target: portfolio.slug,
      detail: "own brokerage account, to connect moomoo",
    });
    logger.info("portfolio.own_broker.created", { portfolio: portfolio.slug });
  }

  return Response.json({ slug: portfolio.slug, created });
}
