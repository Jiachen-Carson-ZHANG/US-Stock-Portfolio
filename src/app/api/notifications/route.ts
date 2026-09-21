import { getCurrentUser, unauthorized } from "@/lib/auth/guards";
import { getDb } from "@/lib/db";
import { rejectCrossOrigin } from "@/lib/http/origin";
import { markRead, notificationsFor, unreadCount } from "@/lib/notifications";

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const db = await getDb();
  const [notifications, unread] = await Promise.all([
    notificationsFor(db, user.id),
    unreadCount(db, user.id),
  ]);
  return Response.json({ notifications, unread });
}

/** Marks one notification read, or all of them when no id is given. */
export async function POST(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;

  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body = await request.json().catch(() => ({}));
  const id = typeof body?.id === "string" ? body.id : null;

  const read = await markRead(await getDb(), user.id, id);
  return Response.json({ read });
}
