import { getCurrentUser, unauthorized } from "@/lib/auth/guards";
import { getDb } from "@/lib/db";
import { rejectCrossOrigin } from "@/lib/http/origin";
import { displayNameSchema } from "@/lib/schemas";

/**
 * Changing the name you are shown under.
 *
 * The username is the address and does not move — slugs are built from it,
 * and a portfolio that changed its URL because somebody renamed themselves
 * would break every link anybody had. The display name is only a label, so
 * it is free to change, and it changes on the portfolios that carry it too:
 * a sidebar reading "Carson" above a portfolio still called "Owner" is worse
 * than either on its own.
 */
export async function PATCH(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;

  const user = await getCurrentUser();
  if (!user) return unauthorized();

  const body = await request.json().catch(() => ({}));
  const parsed = displayNameSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "That name will not do." },
      { status: 400 },
    );
  }

  const name = parsed.data.displayName;
  const db = await getDb();

  await db.transaction(async (tx) => {
    await tx.run(`UPDATE users SET display_name = ? WHERE id = ?`, [name, user.id]);
    await tx.run(
      `UPDATE portfolios SET display_name = ? WHERE owner_user_id = ? AND kind = 'broker'`,
      [name, user.id],
    );
    await tx.run(
      `UPDATE portfolios SET display_name = ? WHERE owner_user_id = ? AND kind = 'mock'`,
      [`${name} · mock`, user.id],
    );
  });

  return Response.json({ ok: true, displayName: name });
}
