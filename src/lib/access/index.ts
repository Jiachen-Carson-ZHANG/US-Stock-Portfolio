import { randomUUID } from "node:crypto";
import type { DB } from "@/lib/db";
import { notify } from "@/lib/notifications";
import { findById, grantAccess } from "@/lib/portfolios";

export type AccessRequest = {
  id: string;
  portfolioId: string;
  portfolioSlug: string;
  portfolioName: string;
  userId: string;
  userName: string;
  message: string | null;
  status: "pending" | "approved" | "declined";
  createdAt: string;
};

type Row = {
  id: string;
  portfolio_id: string;
  portfolio_slug: string;
  portfolio_name: string;
  user_id: string;
  user_name: string;
  message: string | null;
  status: AccessRequest["status"];
  created_at: string;
};

const toRequest = (row: Row): AccessRequest => ({
  id: row.id,
  portfolioId: row.portfolio_id,
  portfolioSlug: row.portfolio_slug,
  portfolioName: row.portfolio_name,
  userId: row.user_id,
  userName: row.user_name,
  message: row.message,
  status: row.status,
  createdAt: row.created_at,
});

const SELECT = `
  SELECT r.id, r.portfolio_id, p.slug AS portfolio_slug, p.display_name AS portfolio_name,
         r.user_id, u.display_name AS user_name, r.message, r.status, r.created_at
    FROM access_requests r
    JOIN portfolios p ON p.id = r.portfolio_id
    JOIN users u ON u.id = r.user_id`;

/**
 * Asks the owner of a portfolio to share it.
 *
 * Idempotent on purpose: asking a second time while the first is unanswered
 * changes nothing and sends nothing, so nobody can flood the owner's bell by
 * refreshing the page.
 */
export async function requestAccess(
  db: DB,
  input: { portfolioId: string; userId: string; userName: string; message?: string },
  now: Date = new Date(),
): Promise<{ created: boolean }> {
  const existing = await db.get<{ id: string }>(
    `SELECT id FROM access_requests
      WHERE portfolio_id = ? AND user_id = ? AND status = 'pending'`,
    [input.portfolioId, input.userId],
  );
  if (existing) return { created: false };

  const portfolio = await findById(db, input.portfolioId);
  if (!portfolio) return { created: false };

  await db.run(
    `INSERT INTO access_requests (id, portfolio_id, user_id, message, status, created_at)
     VALUES (?, ?, ?, ?, 'pending', ?)`,
    [randomUUID(), input.portfolioId, input.userId, input.message ?? null, now.toISOString()],
  );

  // The owner decides, so the owner is told. Administrators can also see the
  // queue in settings, but the notification goes to whose portfolio it is.
  if (portfolio.ownerUserId) {
    await notify(
      db,
      {
        userId: portfolio.ownerUserId,
        kind: "access_request",
        title: `${input.userName} would like to see ${portfolio.displayName}`,
        body: input.message ?? null,
        link: "/settings#access",
      },
      now,
    );
  }

  return { created: true };
}

export async function pendingRequests(db: DB): Promise<AccessRequest[]> {
  const rows = await db.all<Row>(
    `${SELECT} WHERE r.status = 'pending' ORDER BY r.created_at`,
  );
  return rows.map(toRequest);
}

/** Only the portfolio's owner may answer; being an administrator is not enough. */
export async function pendingRequestsFor(
  db: DB,
  ownerUserId: string,
): Promise<AccessRequest[]> {
  const rows = await db.all<Row>(
    `${SELECT} WHERE r.status = 'pending' AND p.owner_user_id = ? ORDER BY r.created_at`,
    [ownerUserId],
  );
  return rows.map(toRequest);
}

export async function decideRequest(
  db: DB,
  input: {
    requestId: string;
    deciderId: string;
    approve: boolean;
    /** Owners may answer for portfolios that have no owner set. */
    isAdministrator: boolean;
  },
  now: Date = new Date(),
): Promise<{ ok: boolean; reason?: string }> {
  const row = await db.get<{
    portfolio_id: string;
    portfolio_slug: string;
    portfolio_name: string;
    user_id: string;
    owner_user_id: string | null;
  }>(
    `SELECT r.portfolio_id, r.user_id,
            p.slug AS portfolio_slug, p.display_name AS portfolio_name,
            p.owner_user_id
       FROM access_requests r
       JOIN portfolios p ON p.id = r.portfolio_id
      WHERE r.id = ? AND r.status = 'pending'`,
    [input.requestId],
  );

  if (!row) return { ok: false, reason: "No such request" };

  const mayDecide =
    row.owner_user_id === input.deciderId ||
    (input.isAdministrator && row.owner_user_id === null);
  if (!mayDecide) return { ok: false, reason: "Only the owner can answer this" };

  await db.run(
    `UPDATE access_requests SET status = ?, decided_at = ?, decided_by = ? WHERE id = ?`,
    [input.approve ? "approved" : "declined", now.toISOString(), input.deciderId, input.requestId],
  );

  if (input.approve) await grantAccess(db, row.portfolio_id, row.user_id, now);

  await notify(
    db,
    {
      userId: row.user_id,
      kind: input.approve ? "access_granted" : "access_declined",
      title: input.approve
        ? `${row.portfolio_name} is now shared with you`
        : `${row.portfolio_name} was not shared`,
      link: input.approve ? `/${row.portfolio_slug}` : null,
    },
    now,
  );

  return { ok: true };
}
