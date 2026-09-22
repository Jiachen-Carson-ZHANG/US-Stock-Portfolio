import { recordActivity } from "@/lib/activity";
import { requireApiOwner } from "@/lib/auth/guards";
import { getDb } from "@/lib/db";
import { rejectCrossOrigin } from "@/lib/http/origin";
import { decideAccount, pendingAccounts } from "@/lib/accounts";
import { accountDecisionSchema } from "@/lib/schemas";

/** Who is waiting to be let in. Owner only — it names people. */
export async function GET() {
  const auth = await requireApiOwner();
  if ("response" in auth) return auth.response;
  return Response.json({ pending: await pendingAccounts(await getDb()) });
}

export async function PATCH(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;

  const auth = await requireApiOwner();
  if ("response" in auth) return auth.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body" }, { status: 400 });
  }

  const parsed = accountDecisionSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ error: "Invalid request" }, { status: 400 });
  }

  const db = await getDb();
  const result = await decideAccount(db, {
    userId: parsed.data.userId,
    deciderId: auth.user.id,
    approve: parsed.data.approve,
  });

  if (!result.ok) {
    return Response.json({ error: result.reason ?? "Could not answer" }, { status: 404 });
  }

  await recordActivity(db, {
    userId: auth.user.id,
    username: auth.user.username,
    kind: parsed.data.approve ? "account_approve" : "account_decline",
    target: parsed.data.userId,
  });

  return Response.json({ ok: true });
}
