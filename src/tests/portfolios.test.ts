import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, TEST_PORTFOLIO_ID, type TestDb } from "@/lib/db/testing";
import type { AuthUser } from "@/lib/auth/session";
import {
  canRead,
  canWrite,
  createPortfolio,
  defaultFor,
  directoryFor,
  ensureDefaultPortfolio,
  findBySlug,
  grantAccess,
  revokeAccess,
  visibleTo,
} from "@/lib/portfolios";
import { portfolioStart } from "@/lib/portfolio/service";
import { requestAccess } from "@/lib/access";

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
  return { id, username, displayName: username, role, status: "active" as const };
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
      kind: "mock",
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
          kind: "mock",
        }),
      ).rejects.toThrow();
    }
  });
});

describe("when a portfolio's history starts", () => {
  it("takes the earliest of a transfer and a valuation", async () => {
    await db.run(
      `INSERT INTO analysis_flows (id, date, amount, note, created_by, portfolio_id)
       VALUES (?, '2026-05-20', 5000, 'seed', 'test', ?)`,
      [randomUUID(), TEST_PORTFOLIO_ID],
    );
    await db.run(
      `INSERT INTO portfolio_snapshots
         (id, snapshot_date, total_market_value, total_cost, total_unrealized_pnl,
          cash_value, positions_json, created_at, source, portfolio_id)
       VALUES (?, '2026-06-03', '5000', '0', '0', '5000', '[]', ?, 'reconstructed', ?)`,
      [randomUUID(), new Date().toISOString(), TEST_PORTFOLIO_ID],
    );

    expect(await portfolioStart(db, TEST_PORTFOLIO_ID)).toBe("2026-05-20");
  });

  // The bug this replaces: one clever SELECT reusing a positional parameter
  // across two subqueries returned null, and the card lost its date.
  it("still answers when only one of the two exists", async () => {
    await db.run(
      `INSERT INTO portfolio_snapshots
         (id, snapshot_date, total_market_value, total_cost, total_unrealized_pnl,
          cash_value, positions_json, created_at, source, portfolio_id)
       VALUES (?, '2026-06-03', '5000', '0', '0', '5000', '[]', ?, 'reconstructed', ?)`,
      [randomUUID(), new Date().toISOString(), TEST_PORTFOLIO_ID],
    );

    expect(await portfolioStart(db, TEST_PORTFOLIO_ID)).toBe("2026-06-03");
  });

  it("returns nothing for a portfolio with no history at all", async () => {
    expect(await portfolioStart(db, TEST_PORTFOLIO_ID)).toBeNull();
  });
});

describe("the directory", () => {
  it("lists everything, and marks what you may open", async () => {
    const mile = await addUser("mile");
    const jane = await addUser("jane");
    const hers = await createPortfolio(db, {
      slug: "mirat",
      displayName: "Mile",
      ownerUserId: mile.id,
      kind: "broker",
    });

    const seen = await directoryFor(db, jane);
    const bySlug = Object.fromEntries(seen.map((entry) => [entry.slug, entry]));

    // The locked one is present, named, and marked shut.
    expect(bySlug.mirat).toBeDefined();
    expect(bySlug.mirat.readable).toBe(false);
    expect(bySlug.mirat.ownerName).toBe("mile");
    expect(bySlug.carson.readable).toBe(false);

    await grantAccess(db, hers.id, jane.id);
    const after = await directoryFor(db, jane);
    expect(after.find((entry) => entry.slug === "mirat")?.readable).toBe(true);
  });

  // The whole point of showing a locked row is that nothing sensitive rides
  // along with the name.
  it("carries no holdings, values or returns", async () => {
    const jane = await addUser("jane");
    const seen = await directoryFor(db, jane);

    for (const entry of seen) {
      expect(Object.keys(entry).sort()).toEqual([
        "baseCurrency",
        "createdAt",
        "displayName",
        "id",
        "kind",
        "openingCash",
        "ownerName",
        "ownerUserId",
        "readable",
        "requested",
        "slug",
      ]);
    }
  });

  it("remembers that you already asked", async () => {
    const mile = await addUser("mile");
    const jane = await addUser("jane");
    const hers = await createPortfolio(db, {
      slug: "mirat",
      displayName: "Mile",
      ownerUserId: mile.id,
      kind: "broker",
    });

    expect((await directoryFor(db, jane)).find((e) => e.slug === "mirat")?.requested).toBe(
      false,
    );

    await requestAccess(db, {
      portfolioId: hers.id,
      userId: jane.id,
      userName: jane.displayName,
    });

    expect((await directoryFor(db, jane)).find((e) => e.slug === "mirat")?.requested).toBe(
      true,
    );
  });

  it("shows an administrator everything as readable", async () => {
    const admin = await addUser("carson", "owner");
    const mile = await addUser("mile");
    await createPortfolio(db, {
      slug: "mirat",
      displayName: "Mile",
      ownerUserId: mile.id,
      kind: "broker",
    });

    expect((await directoryFor(db, admin)).every((entry) => entry.readable)).toBe(true);
  });
});
