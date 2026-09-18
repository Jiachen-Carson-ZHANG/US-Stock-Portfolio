import { requireApiOwner } from "@/lib/auth/guards";
import { getDb } from "@/lib/db";

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
