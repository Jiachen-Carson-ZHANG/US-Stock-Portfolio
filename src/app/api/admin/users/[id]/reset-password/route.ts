import { randomBytes } from "node:crypto";
import { recordActivity } from "@/lib/activity";
import { requireApiOwner } from "@/lib/auth/guards";
import { hashPassword } from "@/lib/auth/password";
import { revokeAllSessionsForUser } from "@/lib/auth/session";
import { clearFailedAttempts } from "@/lib/auth/rate-limit";
import { getDb } from "@/lib/db";
import { rejectCrossOrigin } from "@/lib/http/origin";
import { logger } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * Giving somebody a way back in.
 *
 * The owner never chooses the new password and never learns the old one. A
 * random temporary password is generated, shown once to whoever pressed the
 * button so it can be passed on, and stored only as a hash like every other.
 * The person signs in with it and changes it on their account page.
 *
 * Every existing session for that account ends. If somebody else had got in —
 * which is one of the reasons people ask for a reset — they are out.
 *
 * Owners cannot be reset from here, including yourself: an owner who has
 * forgotten their own password is locked out by design, not by accident, and
 * the recovery for that is the seed script with access to the server.
 */
function temporaryPassword(): string {
  // Twelve characters from an alphabet with no look-alikes (no 0/O, 1/l/I),
  // because this will be read aloud or typed from a message.
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(12);
  return [...bytes].map((byte) => alphabet[byte % alphabet.length]).join("");
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const originError = rejectCrossOrigin(request);
  if (originError) return originError;

  const auth = await requireApiOwner();
  if ("response" in auth) return auth.response;

  const { id } = await params;
  const db = await getDb();
  const target = await db.get<{ username: string; role: string }>(
    `SELECT username, role FROM users WHERE id = ?`,
    [id],
  );
  if (!target) return Response.json({ error: "No such account" }, { status: 404 });
  if (target.role === "owner") {
    return Response.json(
      { error: "An owner's password cannot be reset from here." },
      { status: 409 },
    );
  }

  const password = temporaryPassword();
  await db.run(`UPDATE users SET password_hash = ? WHERE id = ?`, [
    await hashPassword(password),
    id,
  ]);
  const revoked = await revokeAllSessionsForUser(db, id);
  // A locked-out person asking for a reset should not then find the lockout
  // still standing between them and the new password.
  await clearFailedAttempts(db, target.username);

  logger.info("account.password_reset", { username: target.username });
  await recordActivity(db, {
    userId: auth.user.id,
    username: auth.user.username,
    kind: "password_reset",
    target: target.username,
  });

  // Returned once, to the owner who asked, and not stored anywhere readable.
  return Response.json(
    { ok: true, username: target.username, temporaryPassword: password, revoked },
    { headers: { "Cache-Control": "no-store" } },
  );
}
