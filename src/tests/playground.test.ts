import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { createTestDb, type TestDb } from "@/lib/db/testing";
import { addPost, PostError, readRoom, removePost, symbolsIn } from "@/lib/playground";

let db: TestDb;
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
  alice = await makeUser("alice");
  bob = await makeUser("bob");
});

afterEach(async () => {
  await db.close();
});

describe("saying something", () => {
  it("keeps the ticker and the timeframe on a topic", async () => {
    await addPost(db, {
      userId: alice,
      author: "Alice",
      body: "This one still looks cheap.",
      symbol: "nvda",
      horizon: "one-year",
    });

    const [thread] = await readRoom(db);
    expect(thread.symbol).toBe("NVDA");
    expect(thread.horizon).toBe("one-year");
    expect(thread.author).toBe("Alice");
  });

  it("refuses an empty one", async () => {
    await expect(
      addPost(db, { userId: alice, author: "Alice", body: "   " }),
    ).rejects.toBeInstanceOf(PostError);
  });

  it("hangs a reply under its topic", async () => {
    const topic = await addPost(db, { userId: alice, author: "Alice", body: "Thoughts?" });
    await addPost(db, {
      userId: bob,
      author: "Bob",
      body: "Not convinced.",
      parentId: topic.id,
    });

    const threads = await readRoom(db);
    expect(threads).toHaveLength(1);
    expect(threads[0].replies.map((r) => r.body)).toEqual(["Not convinced."]);
  });

  it("keeps the thread one level deep", async () => {
    const topic = await addPost(db, { userId: alice, author: "Alice", body: "Thoughts?" });
    const reply = await addPost(db, {
      userId: bob,
      author: "Bob",
      body: "No.",
      parentId: topic.id,
    });

    await expect(
      addPost(db, { userId: alice, author: "Alice", body: "Why?", parentId: reply.id }),
    ).rejects.toBeInstanceOf(PostError);
  });

  it("does not let a reply carry its own ticker, which would read as a new topic", async () => {
    const topic = await addPost(db, { userId: alice, author: "Alice", body: "Thoughts?" });
    await addPost(db, {
      userId: bob,
      author: "Bob",
      body: "Look at this instead.",
      symbol: "AMD",
      horizon: "one-year",
      parentId: topic.id,
    });

    const [thread] = await readRoom(db);
    expect(thread.replies[0].symbol).toBeNull();
    expect(thread.replies[0].horizon).toBeNull();
  });

  it("reads newest topic first, and each conversation downwards", async () => {
    const first = await addPost(
      db,
      { userId: alice, author: "Alice", body: "First" },
      new Date("2026-09-01T10:00:00Z"),
    );
    await addPost(
      db,
      { userId: bob, author: "Bob", body: "Earlier reply", parentId: first.id },
      new Date("2026-09-01T11:00:00Z"),
    );
    await addPost(
      db,
      { userId: bob, author: "Bob", body: "Later reply", parentId: first.id },
      new Date("2026-09-01T12:00:00Z"),
    );
    await addPost(
      db,
      { userId: bob, author: "Bob", body: "Second" },
      new Date("2026-09-02T10:00:00Z"),
    );

    const threads = await readRoom(db);
    expect(threads.map((t) => t.body)).toEqual(["Second", "First"]);
    expect(threads[1].replies.map((r) => r.body)).toEqual([
      "Earlier reply",
      "Later reply",
    ]);
  });
});

describe("taking something back", () => {
  it("lets you remove your own", async () => {
    const post = await addPost(db, { userId: alice, author: "Alice", body: "Oops" });
    expect(await removePost(db, { id: post.id, userId: alice, isAdministrator: false })).toBe(
      true,
    );
    expect(await readRoom(db)).toEqual([]);
  });

  it("does not let you remove somebody else's", async () => {
    const post = await addPost(db, { userId: alice, author: "Alice", body: "Mine" });
    expect(await removePost(db, { id: post.id, userId: bob, isAdministrator: false })).toBe(
      false,
    );
    expect(await readRoom(db)).toHaveLength(1);
  });

  it("lets whoever runs the place remove anything", async () => {
    const post = await addPost(db, { userId: alice, author: "Alice", body: "Mine" });
    expect(await removePost(db, { id: post.id, userId: bob, isAdministrator: true })).toBe(
      true,
    );
  });

  it("takes the replies with the topic", async () => {
    const topic = await addPost(db, { userId: alice, author: "Alice", body: "Topic" });
    await addPost(db, { userId: bob, author: "Bob", body: "Reply", parentId: topic.id });

    await removePost(db, { id: topic.id, userId: alice, isAdministrator: false });

    const left = await db.all(`SELECT id FROM playground_posts`);
    expect(left).toEqual([]);
  });
});

describe("pricing the room", () => {
  it("names each ticker once", async () => {
    await addPost(db, { userId: alice, author: "Alice", body: "a", symbol: "NVDA" });
    await addPost(db, { userId: bob, author: "Bob", body: "b", symbol: "NVDA" });
    await addPost(db, { userId: bob, author: "Bob", body: "c", symbol: "AMD" });
    await addPost(db, { userId: bob, author: "Bob", body: "no ticker" });

    expect(symbolsIn(await readRoom(db)).sort()).toEqual(["AMD", "NVDA"]);
  });
});
