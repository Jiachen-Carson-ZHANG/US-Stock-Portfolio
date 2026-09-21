import { recordActivity } from "@/lib/activity";
import { requireApiOwner } from "@/lib/auth/guards";
import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";
import { syncPositions } from "@/lib/portfolio/sync";
import { activeProvider, getBrokerProvider } from "@/providers";

export async function POST() {
  const auth = await requireApiOwner();
  if ("response" in auth) return auth.response;

  const provider = await activeProvider();
  const db = await getDb();

  try {
    const count = await syncPositions(
      db,
      await getBrokerProvider(),
      provider === "moomoo" ? "moomoo" : "mock",
    );
    await recordActivity(db, {
      userId: auth.user.id,
      username: auth.user.username,
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
