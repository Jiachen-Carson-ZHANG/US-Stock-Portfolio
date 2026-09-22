import { randomUUID } from "node:crypto";
import type { DB } from "@/lib/db";
import type { AuthUser } from "@/lib/auth/session";

export type PortfolioKind = "broker" | "mock";

export type Portfolio = {
  id: string;
  slug: string;
  displayName: string;
  ownerUserId: string | null;
  kind: PortfolioKind;
  baseCurrency: string;
  openingCash: string | null;
  createdAt: string;
};

type Row = {
  id: string;
  slug: string;
  display_name: string;
  owner_user_id: string | null;
  kind: PortfolioKind;
  base_currency: string;
  opening_cash: string | null;
  created_at: string;
};

const toPortfolio = (row: Row): Portfolio => ({
  id: row.id,
  slug: row.slug,
  displayName: row.display_name,
  ownerUserId: row.owner_user_id,
  kind: row.kind,
  baseCurrency: row.base_currency,
  openingCash: row.opening_cash,
  createdAt: row.created_at,
});

const COLUMNS = `id, slug, display_name, owner_user_id, kind, base_currency, opening_cash, created_at`;

/**
 * The portfolio every pre-existing row belongs to.
 *
 * Before portfolios existed there was exactly one, and its rows carry no
 * owner. Rather than guess per row, the first boot after this change creates
 * this portfolio and stamps everything with it — which is correct, because
 * everything recorded until now really was Carson's account.
 */
export const DEFAULT_SLUG = "carson";

/** Slugs are a URL segment, so they are restricted to what reads cleanly. */
export const SLUG_PATTERN = /^[a-z][a-z0-9-]{1,30}$/;

export async function listPortfolios(db: DB): Promise<Portfolio[]> {
  const rows = await db.all<Row>(`SELECT ${COLUMNS} FROM portfolios ORDER BY created_at`);
  return rows.map(toPortfolio);
}

export async function findBySlug(db: DB, slug: string): Promise<Portfolio | null> {
  const row = await db.get<Row>(`SELECT ${COLUMNS} FROM portfolios WHERE slug = ?`, [slug]);
  return row ? toPortfolio(row) : null;
}

export async function findById(db: DB, id: string): Promise<Portfolio | null> {
  const row = await db.get<Row>(`SELECT ${COLUMNS} FROM portfolios WHERE id = ?`, [id]);
  return row ? toPortfolio(row) : null;
}

/**
 * The one access rule, expressed once.
 *
 * You may read a portfolio if you own it, if someone granted you a row in
 * portfolio_access, or if you hold the owner role. Everything else — the
 * switcher, the nav, the Arena — is a view over this, never a substitute for
 * it. A hidden link is not access control, so every loader re-asks.
 */
export async function visibleTo(db: DB, user: AuthUser): Promise<Portfolio[]> {
  if (user.role === "owner") return listPortfolios(db);

  const rows = await db.all<Row>(
    `SELECT DISTINCT ${COLUMNS.split(", ").map((c) => `p.${c}`).join(", ")}
       FROM portfolios p
       LEFT JOIN portfolio_access a ON a.portfolio_id = p.id AND a.user_id = ?
      WHERE p.owner_user_id = ? OR a.user_id IS NOT NULL
      ORDER BY p.created_at`,
    [user.id, user.id],
  );
  return rows.map(toPortfolio);
}

export type DirectoryEntry = Portfolio & {
  readable: boolean;
  ownerName: string | null;
  /** True when this person has already asked and is waiting on an answer. */
  requested: boolean;
};

/**
 * Every portfolio, marked with whether this person may open it.
 *
 * Deliberately shows the ones they cannot: a locked row with a name is how
 * somebody knows there is something to ask for. The rule that matters is
 * still enforced in the loaders — this list carries a name and a flag, never
 * a holding or a figure.
 */
export async function directoryFor(
  db: DB,
  user: AuthUser,
): Promise<DirectoryEntry[]> {
  const rows = await db.all<
    Row & { owner_name: string | null; granted: boolean | null; requested: boolean | null }
  >(
    `SELECT p.id, p.slug, p.display_name, p.owner_user_id, p.kind,
            p.base_currency, p.opening_cash, p.created_at,
            u.display_name AS owner_name,
            (a.user_id IS NOT NULL) AS granted,
            (r.id IS NOT NULL) AS requested
       FROM portfolios p
       LEFT JOIN users u ON u.id = p.owner_user_id
       LEFT JOIN portfolio_access a ON a.portfolio_id = p.id AND a.user_id = ?
       LEFT JOIN access_requests r
              ON r.portfolio_id = p.id AND r.user_id = ? AND r.status = 'pending'
      ORDER BY p.created_at`,
    [user.id, user.id],
  );

  return rows.map((row) => ({
    ...toPortfolio(row),
    ownerName: row.owner_name,
    readable:
      user.role === "owner" || row.owner_user_id === user.id || row.granted === true,
    requested: row.requested === true,
  }));
}

export async function canRead(
  db: DB,
  user: AuthUser,
  portfolioId: string,
): Promise<boolean> {
  if (user.role === "owner") return true;

  const row = await db.get<{ ok: boolean }>(
    `SELECT TRUE AS ok
       FROM portfolios p
       LEFT JOIN portfolio_access a ON a.portfolio_id = p.id AND a.user_id = ?
      WHERE p.id = ? AND (p.owner_user_id = ? OR a.user_id IS NOT NULL)
      LIMIT 1`,
    [user.id, portfolioId, user.id],
  );
  return row?.ok === true;
}

/**
 * Writing is narrower than reading: you can look at your sister's portfolio
 * but you cannot record a deposit into it. The owner role is deliberately not
 * a write override — being an administrator is not the same as being the
 * person whose money it is.
 */
export function canWrite(user: AuthUser, portfolio: Portfolio): boolean {
  return portfolio.ownerUserId === user.id;
}

/** Where "/" sends someone: their own portfolio, else the first they can see. */
export async function defaultFor(db: DB, user: AuthUser): Promise<Portfolio | null> {
  const visible = await visibleTo(db, user);
  return visible.find((p) => p.ownerUserId === user.id) ?? visible[0] ?? null;
}

export async function createPortfolio(
  db: DB,
  input: {
    slug: string;
    displayName: string;
    // Null only during the first boot of a database that has no users yet.
    ownerUserId: string | null;
    kind: PortfolioKind;
    baseCurrency?: string;
    openingCash?: string | null;
  },
  now: Date = new Date(),
): Promise<Portfolio> {
  if (!SLUG_PATTERN.test(input.slug)) {
    throw new Error(
      `"${input.slug}" is not a usable address. Use lowercase letters, digits and hyphens.`,
    );
  }

  const id = randomUUID();
  await db.run(
    `INSERT INTO portfolios (id, slug, display_name, owner_user_id, kind, base_currency, opening_cash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.slug,
      input.displayName,
      input.ownerUserId,
      input.kind,
      input.baseCurrency ?? "USD",
      input.openingCash ?? null,
      now.toISOString(),
    ],
  );

  const created = await findById(db, id);
  if (!created) throw new Error("Portfolio was not created.");
  return created;
}

export async function grantAccess(
  db: DB,
  portfolioId: string,
  userId: string,
  now: Date = new Date(),
): Promise<void> {
  await db.run(
    `INSERT INTO portfolio_access (portfolio_id, user_id, granted_at)
     VALUES (?, ?, ?)
     ON CONFLICT (portfolio_id, user_id) DO NOTHING`,
    [portfolioId, userId, now.toISOString()],
  );
}

export async function revokeAccess(
  db: DB,
  portfolioId: string,
  userId: string,
): Promise<void> {
  await db.run(
    `DELETE FROM portfolio_access WHERE portfolio_id = ? AND user_id = ?`,
    [portfolioId, userId],
  );
}

export async function readersOf(db: DB, portfolioId: string): Promise<string[]> {
  const rows = await db.all<{ user_id: string }>(
    `SELECT user_id FROM portfolio_access WHERE portfolio_id = ?`,
    [portfolioId],
  );
  return rows.map((row) => row.user_id);
}

const SCOPED_TABLES = [
  "positions",
  "transactions",
  "broker_connections",
  "portfolio_snapshots",
  "analysis_flows",
  "analysis_config",
] as const;

/**
 * Creates the default portfolio if none exists and adopts every unowned row.
 *
 * Runs on every boot because it is cheap and idempotent, and because the
 * alternative — a one-shot migration script someone has to remember — is how
 * a deployment ends up with rows no portfolio can see. Safe to call
 * concurrently: the slug is unique, so a second caller loses the insert and
 * then finds the winner's row.
 *
 * Only adopts rows when exactly one portfolio exists. Once there are two, an
 * unowned row is ambiguous and belongs in a report rather than in a guess.
 */
export async function ensureDefaultPortfolio(
  db: DB,
  now: Date = new Date(),
): Promise<Portfolio | null> {
  const existing = await listPortfolios(db);

  // Annotated: without it the initializer infers a non-null type and the
  // recovery path below stops compiling.
  let portfolio: Portfolio | null =
    existing.find((p) => p.slug === DEFAULT_SLUG) ?? existing[0] ?? null;

  if (!portfolio) {
    const owner = await db.get<{ id: string; display_name: string }>(
      `SELECT id, display_name FROM users WHERE role = 'owner' ORDER BY created_at LIMIT 1`,
    );
    try {
      portfolio = await createPortfolio(
        db,
        {
          slug: DEFAULT_SLUG,
          displayName: owner?.display_name ?? "Carson",
          // Left unset when the database has no users yet, which happens on a
          // fresh deployment before seeding. Filled in below on a later boot.
          ownerUserId: owner?.id ?? null,
          kind: "broker",
          baseCurrency: process.env.PORTFOLIO_BASE_CURRENCY ?? "USD",
        },
        now,
      );
    } catch {
      portfolio = await findBySlug(db, DEFAULT_SLUG);
    }
  }

  if (!portfolio) return null;

  if (!portfolio.ownerUserId) {
    const owner = await db.get<{ id: string; display_name: string }>(
      `SELECT id, display_name FROM users WHERE role = 'owner' ORDER BY created_at LIMIT 1`,
    );
    if (owner) {
      await db.run(
        `UPDATE portfolios SET owner_user_id = ?, display_name = ? WHERE id = ? AND owner_user_id IS NULL`,
        [owner.id, owner.display_name, portfolio.id],
      );
      portfolio = (await findById(db, portfolio.id)) ?? portfolio;
    }
  }

  if (existing.length <= 1) {
    for (const table of SCOPED_TABLES) {
      await db.run(
        `UPDATE ${table} SET portfolio_id = ? WHERE portfolio_id IS NULL`,
        [portfolio.id],
      );
    }
  }

  // The family could always see the one portfolio; making that an explicit
  // row keeps the access rule the only thing that decides, with no implicit
  // "except the original one" case hiding inside it.
  const others = await db.all<{ id: string }>(
    `SELECT id FROM users WHERE id <> ? AND disabled_at IS NULL`,
    [portfolio.ownerUserId ?? ""],
  );
  for (const other of others) {
    await grantAccess(db, portfolio.id, other.id, now);
  }

  return portfolio;
}
