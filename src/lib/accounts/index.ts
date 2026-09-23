import { randomUUID } from "node:crypto";
import type { DB } from "@/lib/db";
import { hashPassword } from "@/lib/auth/password";
import { notify } from "@/lib/notifications";
import {
  DEFAULT_SLUG,
  createPortfolio,
  findBySlug,
  grantAccess,
  SLUG_PATTERN,
} from "@/lib/portfolios";

export type PendingAccount = {
  id: string;
  username: string;
  displayName: string;
  referredBy: string | null;
  /** Written in their own words at sign-up. */
  reason: string | null;
  email: string | null;
  createdAt: string;
};

/** What a new person starts with, so they can take part on day one. */
export const OPENING_MOCK_CASH = "10000";

export class RegistrationError extends Error {}

/**
 * Creates an account that cannot do anything yet.
 *
 * Signup is open, so the guard is approval rather than an invite: the row
 * exists but `status` is pending, and session validation refuses anything
 * that is not active. A pending account therefore has no session, no
 * portfolio and no reachable page — there is nothing to isolate because
 * there is nothing to reach.
 */
export async function register(
  db: DB,
  input: {
    username: string;
    displayName: string;
    password: string;
    referredBy?: string;
    reason?: string;
    email?: string;
  },
  now: Date = new Date(),
): Promise<{ id: string }> {
  const username = input.username.trim().toLowerCase();

  // The username becomes a portfolio address on approval, so it has to be
  // usable in a URL from the start rather than discovered to be unusable
  // later.
  if (!SLUG_PATTERN.test(username)) {
    throw new RegistrationError(
      "Use lowercase letters, digits and hyphens, starting with a letter.",
    );
  }

  const taken = await db.get<{ id: string }>(
    `SELECT id FROM users WHERE username = ?`,
    [username],
  );
  if (taken) throw new RegistrationError("That name is already taken.");

  const id = randomUUID();
  await db.run(
    `INSERT INTO users
       (id, username, display_name, password_hash, role, created_at, status,
        referred_by, intro, email)
     VALUES (?, ?, ?, ?, 'viewer', ?, 'pending', ?, ?, ?)`,
    [
      id,
      username,
      input.displayName.trim() || username,
      await hashPassword(input.password),
      now.toISOString(),
      input.referredBy?.trim() || null,
      input.reason?.trim() || null,
      input.email?.trim() || null,
    ],
  );

  // Everyone who can decide is told, rather than the request sitting unseen
  // until somebody happens to open settings.
  const owners = await db.all<{ id: string }>(
    `SELECT id FROM users WHERE role = 'owner' AND status = 'active' AND disabled_at IS NULL`,
  );
  for (const owner of owners) {
    await notify(
      db,
      {
        userId: owner.id,
        kind: "account_request",
        title: `${input.displayName.trim() || username} would like an account`,
        // The referral is the part that decides most of these, so it goes in
        // the notification rather than only on the settings page.
        body: input.referredBy?.trim()
          ? `@${username} · referred by ${input.referredBy.trim()}`
          : `@${username}`,
        link: "/settings",
        // Which account, so the bell can answer without sending them to
        // settings to find the same person again.
        subjectId: id,
      },
      now,
    );
  }

  return { id };
}

export async function pendingAccounts(db: DB): Promise<PendingAccount[]> {
  const rows = await db.all<{
    id: string;
    username: string;
    display_name: string;
    referred_by: string | null;
    intro: string | null;
    email: string | null;
    created_at: string;
  }>(
    `SELECT id, username, display_name, referred_by, intro, email, created_at
       FROM users WHERE status = 'pending' ORDER BY created_at`,
  );
  return rows.map((row) => ({
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    referredBy: row.referred_by,
    reason: row.intro,
    email: row.email,
    createdAt: row.created_at,
  }));
}

/**
 * Approving is also provisioning.
 *
 * A person who can sign in but has nothing to look at and nothing to do will
 * conclude the site is broken, so approval does the three things that make
 * the account real: it activates the login, shares the family's portfolio so
 * there is something to read, and creates a mock account so there is
 * something to play.
 *
 * Deliberately not granted: any other person's portfolio. Those are asked
 * for, and answered by whoever owns them.
 */
export async function decideAccount(
  db: DB,
  input: { userId: string; deciderId: string; approve: boolean },
  now: Date = new Date(),
): Promise<{ ok: boolean; reason?: string }> {
  const user = await db.get<{ username: string; display_name: string }>(
    `SELECT username, display_name FROM users WHERE id = ? AND status = 'pending'`,
    [input.userId],
  );
  if (!user) return { ok: false, reason: "No such request" };

  if (!input.approve) {
    await db.run(
      `UPDATE users SET status = 'declined', decided_at = ?, decided_by = ? WHERE id = ?`,
      [now.toISOString(), input.deciderId, input.userId],
    );
    return { ok: true };
  }

  await db.run(
    `UPDATE users SET status = 'active', decided_at = ?, decided_by = ? WHERE id = ?`,
    [now.toISOString(), input.deciderId, input.userId],
  );

  const family = await findBySlug(db, DEFAULT_SLUG);
  if (family) await grantAccess(db, family.id, input.userId, now);

  // A clash is possible if somebody already created a portfolio at this
  // address by hand. The account is still approved; they simply start
  // without a mock one and an owner can make it later.
  const slug = `${user.username}-mock`;
  if (!(await findBySlug(db, slug))) {
    try {
      await createPortfolio(
        db,
        {
          slug,
          displayName: user.display_name,
          ownerUserId: input.userId,
          kind: "mock",
          openingCash: OPENING_MOCK_CASH,
        },
        now,
      );
    } catch {
      /* approval is what matters; the portfolio can be added afterwards */
    }
  }

  await notify(
    db,
    {
      userId: input.userId,
      kind: "account_approved",
      title: "Your account is ready",
      body: "You have a mock portfolio to trade, and can see the family portfolio.",
      link: `/${slug}`,
    },
    now,
  );

  return { ok: true };
}
