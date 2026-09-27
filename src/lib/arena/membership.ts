import type { DB } from "@/lib/db";
import type { AuthUser } from "@/lib/auth/session";
import { canWrite, findBySlug, listPortfolios, type Portfolio } from "@/lib/portfolios";

/**
 * Who is in the Arena, by consent.
 *
 * An account competes only once its owner has entered it, account by account,
 * so somebody can race with a practice account and keep a real one out. And
 * the Arena is shown only to people who have entered something themselves:
 * everybody else sees how many are competing and nothing more, until they
 * choose to show their own returns in exchange for seeing everybody else's.
 */
export async function arenaMembers(db: DB): Promise<Portfolio[]> {
  const joined = new Set(
    (await db.all<{ portfolio_id: string }>(`SELECT portfolio_id FROM arena_members`)).map(
      (row) => row.portfolio_id,
    ),
  );
  return (await listPortfolios(db)).filter((portfolio) => joined.has(portfolio.id));
}

export type ArenaAccess = {
  /** Every account competing. */
  members: Portfolio[];
  /** The viewer's own accounts, and whether each has been entered. */
  mine: { portfolio: Portfolio; joined: boolean }[];
  /** True once any of the viewer's own accounts is in. */
  canSee: boolean;
};

export async function arenaAccess(db: DB, user: AuthUser): Promise<ArenaAccess> {
  const members = await arenaMembers(db);
  const joined = new Set(members.map((portfolio) => portfolio.id));
  const mine = (await listPortfolios(db))
    .filter((portfolio) => portfolio.ownerUserId === user.id)
    .map((portfolio) => ({ portfolio, joined: joined.has(portfolio.id) }));
  return { members, mine, canSee: mine.some((entry) => entry.joined) };
}

/** Entering or withdrawing one account. Only the person it belongs to may. */
export async function setArenaMembership(
  db: DB,
  user: AuthUser,
  slug: string,
  join: boolean,
  now: Date = new Date(),
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const portfolio = await findBySlug(db, slug);
  if (!portfolio) return { ok: false, reason: "No such account" };
  if (!canWrite(user, portfolio)) {
    return { ok: false, reason: "Only the person whose account it is can enter it." };
  }
  if (join) {
    await db.run(
      `INSERT INTO arena_members (portfolio_id, joined_at) VALUES (?, ?) ON CONFLICT (portfolio_id) DO NOTHING`,
      [portfolio.id, now.toISOString()],
    );
  } else {
    await db.run(`DELETE FROM arena_members WHERE portfolio_id = ?`, [portfolio.id]);
  }
  return { ok: true };
}
