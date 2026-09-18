import { cookies } from "next/headers";
import { getDb } from "@/lib/db";
import { logger } from "@/lib/logger";
import { SESSION_COOKIE, revokeSession } from "@/lib/auth/session";

export async function POST() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  if (token) {
    revokeSession(await getDb(), token);
    logger.info("auth.logout");
  }

  cookieStore.delete(SESSION_COOKIE);
  return Response.json({ ok: true });
}
