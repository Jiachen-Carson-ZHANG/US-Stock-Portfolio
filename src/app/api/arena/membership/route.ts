import { getCurrentUser, unauthorized } from "@/lib/auth/guards";
import { getDb } from "@/lib/db";
import { rejectCrossOrigin } from "@/lib/http/origin";
import { setArenaMembership } from "@/lib/arena/membership";
import { clearArenaCache } from "@/lib/arena";
import { arenaMembershipSchema } from "@/lib/schemas";

/** Entering one of your own accounts into the Arena, or taking it out. */
export async function POST(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;

  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const parsed = arenaMembershipSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request" }, { status: 400 });

  const result = await setArenaMembership(await getDb(), user, parsed.data.portfolio, parsed.data.join);
  if (!result.ok) return Response.json({ error: result.reason }, { status: 403 });

  clearArenaCache();
  return Response.json({ ok: true });
}
