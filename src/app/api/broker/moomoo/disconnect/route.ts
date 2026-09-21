import { recordActivity } from "@/lib/activity";
import { requireApiOwner } from "@/lib/auth/guards";
import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";
import { clearTokenCache } from "@/lib/moomoo/client";
import { deleteConnection } from "@/lib/moomoo/tokens";

export async function POST() {
  const auth = await requireApiOwner();
  if ("response" in auth) return auth.response;

  const db = await getDb();
  // Awaited: dropping the connection is the whole point of the request, and a
  // floating promise can be discarded once the response has gone out.
  await deleteConnection(db);
  clearTokenCache();
  await recordActivity(db, {
    userId: auth.user.id,
    username: auth.user.username,
    kind: "broker_disconnect",
    detail: "moomoo",
  });
  logger.info("broker.disconnected", { provider: "moomoo" });

  return Response.json({ ok: true });
}
