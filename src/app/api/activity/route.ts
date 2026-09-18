import { authenticateRequest, requireApiOwner, unauthorized } from "@/lib/auth/guards";
import { getDb } from "@/lib/db";
import { activitySchema } from "@/lib/schemas";
import {
  activityByMember,
  mostViewedAssets,
  recentActivity,
  recordActivity,
} from "@/lib/activity";

export async function POST(request: Request) {
  const user = await authenticateRequest();
  if (!user) return unauthorized();

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = activitySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid activity" }, { status: 400 });
  }

  recordActivity(await getDb(), {
    userId: user.id,
    username: user.username,
    kind: parsed.data.kind,
    target: parsed.data.target,
    detail: parsed.data.detail,
  });

  return Response.json({ ok: true });
}

/** Aggregated family activity. Owner only — it names who looked at what. */
export async function GET() {
  const auth = await requireApiOwner();
  if ("response" in auth) return auth.response;

  const db = await getDb();
  return Response.json({
    mostViewed: mostViewedAssets(db),
    byMember: activityByMember(db),
    recent: recentActivity(db, 30),
  });
}
