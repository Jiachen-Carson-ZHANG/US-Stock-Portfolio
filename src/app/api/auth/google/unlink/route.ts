import { getCurrentUser, unauthorized } from "@/lib/auth/guards";
import { unlinkGoogle } from "@/lib/auth/google";
import { getDb } from "@/lib/db";
import { rejectCrossOrigin } from "@/lib/http/origin";

/** Stops a Google account signing in to yours. */
export async function POST(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;
  const user = await getCurrentUser();
  if (!user) return unauthorized();
  await unlinkGoogle(await getDb(), user.id);
  return Response.json({ ok: true });
}
