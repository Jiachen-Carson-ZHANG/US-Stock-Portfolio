import { recordActivity } from "@/lib/activity";
import { requireApiOwner } from "@/lib/auth/guards";
import { getDb } from "@/lib/db";
import { rejectCrossOrigin } from "@/lib/http/origin";
import { logger } from "@/lib/logger";

type Row = {
  id: string;
  username: string;
  display_name: string;
  role: string;
  created_at: string;
  disabled_at: string | null;
  active_sessions: number;
};

export async function GET() {
  const auth = await requireApiOwner();
  if ("response" in auth) return auth.response;

  const db = await getDb();
  // COUNT is bigint, which the driver returns as a string unless it is cast.
  const rows = await db.all<Row>(
    `SELECT u.id, u.username, u.display_name, u.role, u.created_at, u.disabled_at,
            (SELECT COUNT(*) FROM sessions s
              WHERE s.user_id = u.id
                AND s.revoked_at IS NULL
                AND s.expires_at > ?)::int AS active_sessions
       FROM users u
      ORDER BY CASE u.role WHEN 'owner' THEN 0 ELSE 1 END, u.username`,
    [new Date().toISOString()],
  );

  return Response.json({
    users: rows.map((row) => ({
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      role: row.role,
      createdAt: row.created_at,
      disabledAt: row.disabled_at,
      activeSessions: row.active_sessions,
    })),
  });
}

/**
 * Removing an account outright.
 *
 * For the ones made while setting things up, which otherwise sit in the list
 * forever able to sign in. Everything that belongs to them goes with them
 * through the foreign keys: sessions, notifications, posts, and any practice
 * portfolio they own.
 *
 * Two refusals, both deliberate. An owner cannot be removed from here — an
 * account with a real brokerage connection behind it is not something to lose
 * by mis-clicking — and nobody can remove themselves, which would leave the
 * site with one fewer administrator than whoever pressed it intended.
 */
export async function DELETE(request: Request) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;

  const auth = await requireApiOwner();
  if ("response" in auth) return auth.response;

  const body = await request.json().catch(() => ({}));
  const id = typeof body?.userId === "string" ? body.userId : "";
  if (!id) return Response.json({ error: "Invalid request" }, { status: 400 });

  if (id === auth.user.id) {
    return Response.json({ error: "You cannot remove your own account." }, { status: 409 });
  }

  const db = await getDb();
  const target = await db.get<{ username: string; role: string }>(
    `SELECT username, role FROM users WHERE id = ?`,
    [id],
  );
  if (!target) return Response.json({ error: "No such account" }, { status: 404 });

  if (target.role === "owner") {
    return Response.json(
      { error: "An owner account cannot be removed here." },
      { status: 409 },
    );
  }

  const broker = await db.get<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM portfolios
      WHERE owner_user_id = ? AND kind = 'broker'`,
    [id],
  );
  if ((broker?.n ?? 0) > 0) {
    return Response.json(
      {
        error:
          "That account owns a portfolio following a real brokerage account. Move or remove the portfolio first — it holds trade history that cannot be fetched again.",
      },
      { status: 409 },
    );
  }

  await db.run(`DELETE FROM users WHERE id = ?`, [id]);

  logger.info("account.removed", { username: target.username });
  await recordActivity(db, {
    userId: auth.user.id,
    username: auth.user.username,
    kind: "account_remove",
    target: target.username,
  });

  return Response.json({ ok: true });
}
