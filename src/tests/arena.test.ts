import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, TEST_PORTFOLIO_ID, type TestDb } from "@/lib/db/testing";
import type { AuthUser } from "@/lib/auth/session";
import { clearArenaCache, leaderboard, type Standing } from "@/lib/arena";
import { createPortfolio, grantAccess } from "@/lib/portfolios";
import {
  awardCompletedPeriods,
  lastCompletedEnd,
  trophiesFor,
} from "@/lib/arena/trophies";
import { notificationsFor } from "@/lib/notifications";

let db: TestDb;
const NOW = new Date("2026-09-21T20:00:00.000Z");

async function addUser(username: string, role: "owner" | "viewer" = "viewer") {
  const id = randomUUID();
  await db.run(
    `INSERT INTO users (id, username, display_name, password_hash, role, created_at)
     VALUES (?, ?, ?, 'hash', ?, ?)`,
    [id, username, username, role, NOW.toISOString()],
  );
  return { id, username, displayName: username, role } satisfies AuthUser;
}

/** A straight-line climb from `start` to `end` over `days` weekdays. */
async function history(
  portfolioId: string,
  start: number,
  end: number,
  days = 40,
) {
  const cursor = new Date("2026-08-01T00:00:00Z");
  const points: string[] = [];
  while (points.length < days) {
    const weekday = cursor.getUTCDay();
    if (weekday !== 0 && weekday !== 6) points.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  for (const [i, date] of points.entries()) {
    const value = start + ((end - start) * i) / (points.length - 1);
    await db.run(
      `INSERT INTO portfolio_snapshots
         (id, snapshot_date, total_market_value, total_cost, total_unrealized_pnl,
          cash_value, positions_json, created_at, realized_pnl, net_deposits,
          source, portfolio_id)
       VALUES (?, ?, ?, '0', '0', '0', '[]', ?, '0', '0', 'reconstructed', ?)`,
      [randomUUID(), date, value.toFixed(2), NOW.toISOString(), portfolioId],
    );
  }

  // The series refuses to report returns until the cash ledger is attested.
  await db.run(
    `INSERT INTO analysis_flows (id, date, amount, note, created_by, portfolio_id)
     VALUES (?, ?, ?, 'seed', 'test', ?)`,
    [randomUUID(), points[0], start, portfolioId],
  );
  await db.run(
    `INSERT INTO analysis_config (portfolio_id, key, value) VALUES (?, 'review', ?)
     ON CONFLICT (portfolio_id, key) DO UPDATE SET value = excluded.value`,
    [portfolioId, JSON.stringify({ from: points[0], to: points[points.length - 1] })],
  );
}

beforeEach(async () => {
  db = await createTestDb();
  // Each test gets a fresh schema, so a standing cached against another
  // test's fingerprint must not survive into this one.
  clearArenaCache();
});

afterEach(async () => {
  await db.close();
});

describe("the leaderboard", () => {
  it("ranks by return, so the bigger account does not simply win", async () => {
    const admin = await addUser("carson", "owner");
    const mum = await addUser("mother");

    // A large account that grew 10%, and a small one that grew 50%.
    await history(TEST_PORTFOLIO_ID, 20_000, 22_000);
    const small = await createPortfolio(db, {
      slug: "mother-mock",
      displayName: "Mum",
      ownerUserId: mum.id,
      kind: "mock",
      openingCash: "10000",
    });
    await history(small.id, 10_000, 15_000);

    const board = await leaderboard(db, admin, "max", NOW);
    expect(board.standings.map((s) => s.slug)).toEqual(["mother-mock", "carson"]);
    expect(board.standings[0].returnPercent).toBeGreaterThan(
      board.standings[1].returnPercent!,
    );
  });

  it("shows only the portfolios a viewer may open", async () => {
    const mile = await addUser("mile");
    const mum = await addUser("mother");

    const hers = await createPortfolio(db, {
      slug: "mirat",
      displayName: "Mile",
      ownerUserId: mile.id,
      kind: "broker",
    });
    await history(hers.id, 5_000, 6_000);
    const mums = await createPortfolio(db, {
      slug: "mother-mock",
      displayName: "Mum",
      ownerUserId: mum.id,
      kind: "mock",
      openingCash: "10000",
    });
    await history(mums.id, 10_000, 9_000);

    expect((await leaderboard(db, mile, "max", NOW)).standings.map((s) => s.slug)).toEqual([
      "mirat",
    ]);

    await grantAccess(db, mums.id, mile.id);
    const after = await leaderboard(db, mile, "max", NOW);
    expect(after.standings.map((s) => s.slug).sort()).toEqual(["mirat", "mother-mock"]);
  });

  it("puts anyone without a figure below everyone who has one", async () => {
    const admin = await addUser("carson", "owner");
    const mum = await addUser("mother");

    await history(TEST_PORTFOLIO_ID, 20_000, 19_000); // a loss, but a figure
    await createPortfolio(db, {
      slug: "mother-mock",
      displayName: "Mum",
      ownerUserId: mum.id,
      kind: "mock",
      openingCash: "10000",
    }); // no history at all

    const board = await leaderboard(db, admin, "max", NOW);
    expect(board.standings[0].slug).toBe("carson");
    expect(board.standings[1].returnPercent).toBeNull();
    expect(board.standings[1].unavailable).toBeTruthy();
  });

  it("rebases every period to 100 so the curves are comparable", async () => {
    const admin = await addUser("carson", "owner");
    await history(TEST_PORTFOLIO_ID, 10_000, 12_000);

    const board = await leaderboard(db, admin, "max", NOW);
    const curve = board.standings[0].curve;
    expect(curve[0].index).toBeCloseTo(100, 6);
    expect(curve[curve.length - 1].index).toBeGreaterThan(100);
  });
});

// The privacy rule is meant to be enforced by the shape of the data, not by
// remembering not to render a field. This is the test that says so.
describe("what the Arena must never disclose", () => {
  it("carries no account value, cash balance or dollar profit", async () => {
    const admin = await addUser("carson", "owner");
    await history(TEST_PORTFOLIO_ID, 20_000, 22_000);

    const board = await leaderboard(db, admin, "max", NOW);
    const standing: Standing = board.standings[0];

    expect(Object.keys(standing).sort()).toEqual([
      "curve",
      "displayName",
      "kind",
      "returnPercent",
      "slug",
      "unavailable",
    ]);

    // Nothing anywhere in the payload is large enough to be a balance.
    const serialised = JSON.stringify(board);
    expect(serialised).not.toContain("20000");
    expect(serialised).not.toContain("22000");
    for (const point of standing.curve) {
      expect(Math.abs(point.index)).toBeLessThan(1000);
    }
  });
});

describe("the trophy cabinet", () => {
  it("names the last completed week, month and year", () => {
    // A Monday. The week that ended is the Sunday before it.
    const monday = new Date("2026-09-21T10:00:00Z");
    expect(lastCompletedEnd("week", monday)).toBe("2026-09-20");
    expect(lastCompletedEnd("month", monday)).toBe("2026-08-31");
    expect(lastCompletedEnd("year", monday)).toBe("2025-12-31");

    // A Sunday counts its own week as still running.
    const sunday = new Date("2026-09-20T10:00:00Z");
    expect(lastCompletedEnd("week", sunday)).toBe("2026-09-13");
  });

  it("records placings once and not again", async () => {
    const admin = await addUser("carson", "owner");
    const mum = await addUser("mother");

    await history(TEST_PORTFOLIO_ID, 20_000, 22_000);
    const hers = await createPortfolio(db, {
      slug: "mother-mock",
      displayName: "Mum",
      ownerUserId: mum.id,
      kind: "mock",
      openingCash: "10000",
    });
    await history(hers.id, 10_000, 15_000);

    const first = await awardCompletedPeriods(db, NOW);
    expect(first.awarded).toBeGreaterThan(0);

    const again = await awardCompletedPeriods(db, NOW);
    expect(again.awarded).toBe(0);

    const cabinet = await trophiesFor(db, [TEST_PORTFOLIO_ID, hers.id]);
    const winners = cabinet.filter((t) => t.rank === 1);
    expect(winners.length).toBeGreaterThan(0);
    // The smaller account grew more, so it takes first place.
    expect(winners.every((t) => t.portfolioSlug === "mother-mock")).toBe(true);
    expect(admin.role).toBe("owner");
  });

  it("tells the winner", async () => {
    await addUser("carson", "owner");
    const mum = await addUser("mother");
    await history(TEST_PORTFOLIO_ID, 20_000, 20_100);
    const hers = await createPortfolio(db, {
      slug: "mother-mock",
      displayName: "Mum",
      ownerUserId: mum.id,
      kind: "mock",
      openingCash: "10000",
    });
    await history(hers.id, 10_000, 14_000);

    await awardCompletedPeriods(db, NOW);
    const told = await notificationsFor(db, mum.id);
    expect(told.some((n) => n.kind === "trophy")).toBe(true);
  });

  it("awards nothing when there is nobody to compete with", async () => {
    await addUser("carson", "owner");
    await history(TEST_PORTFOLIO_ID, 20_000, 22_000);
    expect((await awardCompletedPeriods(db, NOW)).awarded).toBe(0);
  });
});

it("historical rankings cannot include later valuations", async () => {
  const admin = await addUser("carson", "owner");
  await history(TEST_PORTFOLIO_ID, 10000, 12000);
  const asAt = new Date("2026-08-31T23:59:59Z");
  const before = await leaderboard(db, admin, "month", asAt);
  await db.run("UPDATE portfolio_snapshots SET total_market_value = '99999999' WHERE snapshot_date > '2026-08-31'");
  const after = await leaderboard(db, admin, "month", asAt);
  expect(after).toEqual(before);
  expect(after.standings[0].curve.every((p) => p.date <= "2026-08-31")).toBe(true);
});
it("does not report an old all-time return as this week's result", async () => {
  const admin = await addUser("carson", "owner");
  await history(TEST_PORTFOLIO_ID, 10000, 12000);
  const board = await leaderboard(db, admin, "week", new Date("2027-01-01T12:00:00Z"));
  expect(board.standings[0].returnPercent).toBeNull();
});
