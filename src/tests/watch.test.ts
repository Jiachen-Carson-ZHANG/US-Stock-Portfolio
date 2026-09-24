import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createTestDb, type TestDb } from "@/lib/db/testing";
import { everyoneWatching, mostWatched, myWatchlist, unwatch, watch } from "@/lib/watch";

let db: TestDb;
let carson: string;
let mideil: string;

async function makeUser(username: string, status = "active"): Promise<string> {
  const id = randomUUID();
  await db.run(
    `INSERT INTO users (id, username, display_name, password_hash, role, status, created_at)
     VALUES (?, ?, ?, 'x', 'viewer', ?, ?)`,
    [id, username, username[0].toUpperCase() + username.slice(1), status, new Date().toISOString()],
  );
  return id;
}

beforeEach(async () => {
  db = await createTestDb();
  carson = await makeUser("carson");
  mideil = await makeUser("mideil");
});

afterEach(async () => {
  await db.close();
});

describe("a personal watchlist", () => {
  it("is yours alone — adding a name does not add it for anybody else", async () => {
    await watch(db, carson, "nvda");
    expect(await myWatchlist(db, carson)).toEqual(["NVDA"]);
    expect(await myWatchlist(db, mideil)).toEqual([]);
  });

  it("removing a name removes it only for you", async () => {
    // The old list was one row per symbol for the whole family, so one person
    // removing a name removed it for everyone.
    await watch(db, carson, "NVDA");
    await watch(db, mideil, "NVDA");
    await unwatch(db, carson, "NVDA");

    expect(await myWatchlist(db, carson)).toEqual([]);
    expect(await myWatchlist(db, mideil)).toEqual(["NVDA"]);
  });

  it("ignores adding the same name twice", async () => {
    expect(await watch(db, carson, "NVDA")).toBe(true);
    expect(await watch(db, carson, "NVDA")).toBe(false);
    expect(await myWatchlist(db, carson)).toEqual(["NVDA"]);
  });
});

describe("what everybody is watching", () => {
  it("groups each person's list under their name", async () => {
    await watch(db, carson, "NVDA");
    await watch(db, carson, "AMD");
    await watch(db, mideil, "TSLA");

    const everyone = await everyoneWatching(db);
    const byName = Object.fromEntries(everyone.map((w) => [w.displayName, w.symbols.sort()]));
    expect(byName).toEqual({ Carson: ["AMD", "NVDA"], Mideil: ["TSLA"] });
  });

  it("leaves out somebody who is not an active member", async () => {
    const waiting = await makeUser("waiting", "pending");
    await watch(db, waiting, "GME");

    const names = (await everyoneWatching(db)).map((w) => w.displayName);
    expect(names).not.toContain("Waiting");
  });

  it("surfaces a name only when more than one person watches it", async () => {
    await watch(db, carson, "NVDA");
    await watch(db, mideil, "NVDA");
    await watch(db, carson, "AMD");

    expect(await mostWatched(db)).toEqual([{ symbol: "NVDA", watchers: 2 }]);
  });
});
