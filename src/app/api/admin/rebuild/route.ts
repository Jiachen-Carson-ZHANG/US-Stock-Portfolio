import { requireApiOwner } from "@/lib/auth/guards";
import { rejectCrossOrigin } from "@/lib/http/origin";
import { logger } from "@/lib/logger";
import { rebuildEveryPortfolio } from "@/app/api/cron/reconstruct/route";

export const dynamic = "force-dynamic";
// The hosting plan caps this at 60 seconds whatever is asked for.
export const maxDuration = 60;

/**
 * Rebuilding the daily history from the trades, on request.
 *
 * The same work the monthly job does, reachable by an owner with a session
 * instead of a shared secret. Without this, recovering a missed day meant
 * finding SNAPSHOT_CRON_SECRET in a hosting dashboard and pasting it into a
 * terminal — which is a reasonable thing to ask of a server operator and an
 * unreasonable thing to ask of somebody who just wants yesterday back.
 *
 * Safe to run at any time and safe to run twice: every day is re-derived
 * from the fills, so a second run produces the same rows as the first.
 */
export async function POST(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;

  const auth = await requireApiOwner();
  if ("response" in auth) return auth.response;

  try {
    const results = await rebuildEveryPortfolio();
    const written = results.reduce((total, row) => total + row.written, 0);
    logger.info("portfolio.rebuild.requested", { by: auth.user.username, written });
    return Response.json({ ok: true, written, results });
  } catch (error) {
    logger.error("portfolio.rebuild.failed", {
      reason: error instanceof Error ? error.message : "unknown",
    });
    return Response.json(
      { error: "The rebuild could not finish. It is safe to try again." },
      { status: 502 },
    );
  }
}
