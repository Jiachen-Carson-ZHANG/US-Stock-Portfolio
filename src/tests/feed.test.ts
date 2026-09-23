import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createTestDb, TEST_PORTFOLIO_ID, type TestDb } from "@/lib/db/testing";
import { following, notifyFollowers, subscribe, unsubscribe } from "@/lib/feed";
import { notificationsFor } from "@/lib/notifications";
import { createPortfolio, grantAccess } from "@/lib/portfolios";

let db: TestDb;
let carson: string;
let alice: string;
let bob: string;

async function makeUser(username: string): Promise<string> {
  const id = randomUUID();
  await db.run(
    `INSERT INTO users (id, username, display_name, password_hash, role, status, created_at)
     VALUES (?, ?, ?, 'x', 'viewer', 'active', ?)`,
    [id, username, username, new Date().toISOString()],
  );
  return id;
}

beforeEach(async () => {
  db = await createTestDb();
  carson = await makeUser("carson");
  alice = await makeUser("alice");
  bob = await makeUser("bob");
});

afterEach(async () => {
  await db.close();
});

describe("following somebody", () => {
  it("records it once, however many times the button is pressed", async () => {
    expect(await subscribe(db, alice, carson)).toBe(true);
    expect(await subscribe(db, alice, carson)).toBe(false);
    expect(await following(db, alice)).toEqual([carson]);
  });

  it("is one-directional", async () => {
    await subscribe(db, alice, carson);
    expect(await following(db, carson)).toEqual([]);
  });

  it("refuses to follow yourself", async () => {
    expect(await subscribe(db, alice, alice)).toBe(false);
  });

  it("can be undone", async () => {
    await subscribe(db, alice, carson);
    expect(await unsubscribe(db, alice, carson)).toBe(true);
    expect(await following(db, alice)).toEqual([]);
  });
});

describe("what a follower is told", () => {
  it("rings the bell for something that belongs to no portfolio", async () => {
    await subscribe(db, alice, carson);
    await subscribe(db, bob, carson);

    const sent = await notifyFollowers(db, {
      subjectId: carson,
      kind: "feed_post",
      title: "Carson posted in the playground",
      link: "/playground",
    });

    expect(sent).toBe(2);
    expect((await notificationsFor(db, alice))[0].title).toBe(
      "Carson posted in the playground",
    );
  });

  it("does not become a way past the access rule", async () => {
    // Alice follows Carson but cannot open his portfolio. Following must not
    // tell her what he traded, because that is the thing the rule protects.
    await subscribe(db, alice, carson);
    await db.run(`UPDATE portfolios SET owner_user_id = ? WHERE id = ?`, [
      carson,
      TEST_PORTFOLIO_ID,
    ]);

    const sent = await notifyFollowers(db, {
      subjectId: carson,
      kind: "feed_trade",
      title: "Carson bought NVDA",
      portfolioId: TEST_PORTFOLIO_ID,
    });

    expect(sent).toBe(0);
    expect(await notificationsFor(db, alice)).toEqual([]);
  });

  it("tells a follower who was already allowed to look", async () => {
    await subscribe(db, alice, carson);
    await db.run(`UPDATE portfolios SET owner_user_id = ? WHERE id = ?`, [
      carson,
      TEST_PORTFOLIO_ID,
    ]);
    await grantAccess(db, TEST_PORTFOLIO_ID, alice);

    const sent = await notifyFollowers(db, {
      subjectId: carson,
      kind: "feed_trade",
      title: "Carson bought NVDA",
      portfolioId: TEST_PORTFOLIO_ID,
    });

    expect(sent).toBe(1);
  });

  it("always reaches the portfolio's own owner when they follow", async () => {
    const theirs = await createPortfolio(db, {
      slug: "carson-mock",
      displayName: "Carson mock",
      ownerUserId: carson,
      kind: "mock",
      openingCash: "10000",
    });
    await subscribe(db, alice, carson);
    await grantAccess(db, theirs.id, alice);

    expect(
      await notifyFollowers(db, {
        subjectId: carson,
        kind: "feed_trade",
        title: "Carson bought NVDA",
        portfolioId: theirs.id,
      }),
    ).toBe(1);
  });

  it("says nothing to somebody who is not following", async () => {
    expect(
      await notifyFollowers(db, {
        subjectId: carson,
        kind: "feed_post",
        title: "Carson posted",
      }),
    ).toBe(0);
  });

  it("skips a follower whose account is no longer active", async () => {
    await subscribe(db, alice, carson);
    await db.run(`UPDATE users SET status = 'pending' WHERE id = ?`, [alice]);

    expect(
      await notifyFollowers(db, {
        subjectId: carson,
        kind: "feed_post",
        title: "Carson posted",
      }),
    ).toBe(0);
  });
});
