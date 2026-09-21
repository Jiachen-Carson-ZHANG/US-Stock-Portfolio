import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, TEST_PORTFOLIO_ID, type TestDb } from "@/lib/db/testing";
import type { AuthUser } from "@/lib/auth/session";
import {
  canRead,
  canWrite,
  createPortfolio,
  defaultFor,
  ensureDefaultPortfolio,
  findBySlug,
  grantAccess,
  revokeAccess,
  visibleTo,
} from "@/lib/portfolios";

let db: TestDb;

async function addUser(
  username: string,
  role: "owner" | "viewer" = "viewer",
): Promise<AuthUser> {
  const id = randomUUID();
  await db.run(
    `INSERT INTO users (id, username, display_name, password_hash, role, created_at)
     VALUES (?, ?, ?, 'hash', ?, ?)`,
    [id, username, username, role, new Date().toISOString()],
  );
  return { id, username, displayName: username, role };
}

beforeEach(async () => {
  db = await createTestDb();
});

afterEach(async () => {
  await db.close();
});

describe("who can see what", () => {
  it("lets you see your own portfolio and not your sibling's", async () => {
    const mile = await addUser("mile");
    const zizhe = await addUser("zizhe");

    const hers = await createPortfolio(db, {
      slug: "mirat",
      displayName: "Mile",
      ownerUserId: mile.id,
      kind: "broker",
    });
    const his = await createPortfolio(db, {
      slug: "zizhe",
      displayName: "Zizhe",
      ownerUserId: zizhe.id,
      kind: "paper",
      openingCash: "10000",
    });

    expect(await canRead(db, mile, hers.id)).toBe(true);
    expect(await canRead(db, mile, his.id)).toBe(false);
    expect(await canRead(db, zizhe, hers.id)).toBe(false);

    expect((await visibleTo(db, mile)).map((p) => p.slug)).toEqual(["mirat"]);
  });

  it("opens a portfolio to someone once they are granted access", async () => {
    const mile = await addUser("mile");
    const carson = await addUser("carson-viewer");
    const hers = await createPortfolio(db, {
      slug: "mirat",
      displayName: "Mile",
      ownerUserId: mile.id,
      kind: "broker",
    });

    expect(await canRead(db, carson, hers.id)).toBe(false);
    await grantAccess(db, hers.id, carson.id);
    expect(await canRead(db, carson, hers.id)).toBe(true);
    await revokeAccess(db, hers.id, carson.id);
    expect(await canRead(db, carson, hers.id)).toBe(false);
  });

  it("gives the owner role sight of everything", async () => {
    const mile = await addUser("mile");
    const admin = await addUser("carson", "owner");
    const hers = await createPortfolio(db, {
      slug: "mirat",
      displayName: "Mile",
      ownerUserId: mile.id,
      kind: "broker",
    });

    expect(await canRead(db, admin, hers.id)).toBe(true);
    expect((await visibleTo(db, admin)).map((p) => p.slug)).toContain("mirat");
  });

  // The distinction Carson asked for: he can look at his sister's portfolio
  // and refresh it, but recording a deposit into it is not his to do.
  it("does not let the owner role write to someone else's portfolio", async () => {
    const mile = await addUser("mile");
    const admin = await addUser("carson", "owner");
    const hers = await createPortfolio(db, {
      slug: "mirat",
      displayName: "Mile",
      ownerUserId: mile.id,
      kind: "broker",
    });

    expect(await canRead(db, admin, hers.id)).toBe(true);
    expect(canWrite(admin, hers)).toBe(false);
    expect(canWrite(mile, hers)).toBe(true);
  });

  it("sends you to your own portfolio by default, not the first one listed", async () => {
    const mile = await addUser("mile");
    const carsons = await findBySlug(db, "carson");
    await grantAccess(db, carsons!.id, mile.id);
    const hers = await createPortfolio(db, {
      slug: "mirat",
      displayName: "Mile",
      ownerUserId: mile.id,
      kind: "broker",
    });

    expect((await defaultFor(db, mile))?.id).toBe(hers.id);
  });

  it("falls back to the first readable portfolio for someone who owns none", async () => {
    const dad = await addUser("father");
    const carsons = await findBySlug(db, "carson");
    await grantAccess(db, carsons!.id, dad.id);

    expect((await defaultFor(db, dad))?.slug).toBe("carson");
  });

  it("returns nothing for someone with no portfolio and no grants", async () => {
    const stranger = await addUser("stranger");
    expect(await defaultFor(db, stranger)).toBeNull();
    expect(await visibleTo(db, stranger)).toEqual([]);
  });
});

describe("adopting rows written before portfolios existed", () => {
  it("stamps unowned rows with the default portfolio", async () => {
    // Simulates the pre-migration state: a row with no portfolio at all.
    await db.run(
      `INSERT INTO transactions
         (deal_id, side, symbol, quantity, price, amount, traded_at, synced_at)
       VALUES ('legacy-1', 'buy', 'NVDA', 1, 100, -100, '2026-06-03T14:00:00Z', '2026-06-03T14:00:00Z')`,
    );

    const owner = await addUser("carson", "owner");
    const portfolio = await ensureDefaultPortfolio(db);

    expect(portfolio?.slug).toBe("carson");
    expect(portfolio?.ownerUserId).toBe(owner.id);

    const row = await db.get<{ portfolio_id: string }>(
      `SELECT portfolio_id FROM transactions WHERE deal_id = 'legacy-1'`,
    );
    expect(row?.portfolio_id).toBe(TEST_PORTFOLIO_ID);
  });

  it("leaves unowned rows alone once a second portfolio exists", async () => {
    const mile = await addUser("mile");
    await createPortfolio(db, {
      slug: "mirat",
      displayName: "Mile",
      ownerUserId: mile.id,
      kind: "broker",
    });
    await db.run(
      `INSERT INTO transactions
         (deal_id, side, symbol, quantity, price, amount, traded_at, synced_at)
       VALUES ('ambiguous', 'buy', 'NVDA', 1, 100, -100, '2026-06-03T14:00:00Z', '2026-06-03T14:00:00Z')`,
    );

    await ensureDefaultPortfolio(db);

    // Two portfolios means an unowned row is a question, not a default.
    const row = await db.get<{ portfolio_id: string | null }>(
      `SELECT portfolio_id FROM transactions WHERE deal_id = 'ambiguous'`,
    );
    expect(row?.portfolio_id).toBeNull();
  });

  it("is safe to run twice", async () => {
    await addUser("carson", "owner");
    const first = await ensureDefaultPortfolio(db);
    const second = await ensureDefaultPortfolio(db);
    expect(second?.id).toBe(first?.id);

    const count = await db.get<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM portfolios`,
    );
    expect(count?.n).toBe(1);
  });

  it("grants the rest of the family access to the default portfolio", async () => {
    const owner = await addUser("carson", "owner");
    const dad = await addUser("father");
    await ensureDefaultPortfolio(db);

    expect(await canRead(db, dad, TEST_PORTFOLIO_ID)).toBe(true);
    expect(owner.id).not.toBe(dad.id);
  });
});

describe("slugs", () => {
  it("refuses an address that would not survive a URL", async () => {
    const mile = await addUser("mile");
    for (const slug of ["Mirat", "mi rat", "", "-mirat", "m", "a".repeat(40)]) {
      await expect(
        createPortfolio(db, {
          slug,
          displayName: "x",
          ownerUserId: mile.id,
          kind: "paper",
        }),
      ).rejects.toThrow();
    }
  });
});
