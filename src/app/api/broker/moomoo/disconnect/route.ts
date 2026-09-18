import { requireApiOwner } from "@/lib/auth/guards";
import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";
import { clearTokenCache } from "@/lib/moomoo/client";
import { deleteConnection } from "@/lib/moomoo/tokens";

export async function POST() {
  const auth = await requireApiOwner();
  if ("response" in auth) return auth.response;

  deleteConnection(getDb());
  clearTokenCache();
  logger.info("broker.disconnected", { provider: "moomoo" });

  return Response.json({ ok: true });
}
