import { cookies } from "next/headers";
import { recordActivity } from "@/lib/activity";
import { authenticateRequest } from "@/lib/auth/guards";
import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";
import { SESSION_COOKIE, revokeSession } from "@/lib/auth/session";

export async function POST() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (token) {
    // Identified before the session is revoked, or there is nobody to name.
    const user = await authenticateRequest();
    const db = await getDb();
    // Awaited: a floating promise in a serverless function is not guaranteed
    // to finish once the response has been returned, so the sign-out could be
    // lost and the session stay live.
    await revokeSession(db, token);
    if (user) {
      await recordActivity(db, {
        userId: user.id,
        username: user.username,
        kind: "logout",
      });
    }
    logger.info("auth.logout");
  }

  cookieStore.delete(SESSION_COOKIE);
  return Response.json({ ok: true });
}
