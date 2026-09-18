import { requireApiOwner } from "@/lib/auth/guards";
import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";
import { userIdSchema } from "@/lib/schemas";
import { revokeAllSessionsForUser } from "@/lib/auth/session";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireApiOwner();
  if ("response" in auth) return auth.response;

  const parsed = userIdSchema.safeParse((await params).id);
  if (!parsed.success) {
    return Response.json({ error: "Invalid user id" }, { status: 400 });
  }

  const revoked = await revokeAllSessionsForUser(await getDb(), parsed.data);
  logger.info("admin.sessions_revoked", {
    targetUserId: parsed.data,
    revoked,
    by: auth.user.username,
  });

  return Response.json({ revoked });
}
