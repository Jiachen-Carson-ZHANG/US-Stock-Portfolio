import { getCurrentUser, unauthorized } from "@/lib/auth/guards";
import { getDb } from "@/lib/db";
import { following, subscribe, unsubscribe } from "@/lib/feed";
import { rejectCrossOrigin } from "@/lib/http/origin";

export const dynamic = "force-dynamic";

/** Who you are following. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  return Response.json({ following: await following(await getDb(), user.id) });
}

/**
 * Follow or unfollow somebody.
 *
 * Needs no approval from them, because it grants nothing: what a follower is
 * told about is filtered at send time by what they could already see. The
 * only thing this changes is whether a bell rings.
 */
export async function POST(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;

  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body = await request.json().catch(() => ({}));
  const subjectId = typeof body?.userId === "string" ? body.userId : "";
  const follow = body?.follow !== false;
  if (!subjectId) return Response.json({ error: "Invalid request" }, { status: 400 });
  if (subjectId === user.id) {
    return Response.json({ error: "You already know what you did." }, { status: 400 });
  }

  const db = await getDb();
  const exists = await db.get<{ id: string }>(
    `SELECT id FROM users WHERE id = ? AND status = 'active' AND disabled_at IS NULL`,
    [subjectId],
  );
  if (!exists) return Response.json({ error: "No such person" }, { status: 404 });

  if (follow) await subscribe(db, user.id, subjectId);
  else await unsubscribe(db, user.id, subjectId);

  return Response.json({ ok: true, following: follow });
}
