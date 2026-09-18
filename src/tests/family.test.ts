import { afterEach, beforeEach, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/lib/db/testing";
import { familyAction, readFamily } from "@/lib/family/repository";
const owner = { id: "o", displayName: "Owner", role: "owner" as const };
const viewer = { id: "v", displayName: "Viewer", role: "viewer" as const };
let db: TestDb;
const now = new Date("2026-09-18T12:00:00Z");
beforeEach(async () => {
  db = await createTestDb();
});

afterEach(async () => {
  await db.close();
});
const act = (
  user: typeof owner | typeof viewer,
  action: Record<string, unknown>,
  date = now,
) => familyAction(db, user, action, date);
it("preserves discussions, replies and reactions and enforces author deletion", async () => {
  await act(owner, { action: "post", text: "Our thoughts", symbol: "AAPL" });
  const id = (await readFamily(db, viewer, now)).posts[0].id;
  await act(viewer, { action: "reply", id, text: "Why this company?" });
  await act(viewer, { action: "react", id, reaction: "explain" });
  expect((await readFamily(db, viewer, now)).posts[0].replies).toHaveLength(1);
  await expect(act(viewer, { action: "deletePost", id })).rejects.toThrow();
  expect((await readFamily(db, viewer, now)).posts[0].unread).toBe(true);
  await act(viewer, { action: "read" });
  expect((await readFamily(db, viewer, now)).posts[0].unread).toBe(false);
});
it("allows only one weekly vote per member and unique nominations", async () => {
  await act(owner, { action: "nominate", symbol: "AAPL", text: "Products we use" });
  await expect(act(viewer, { action: "nominate", symbol: "AAPL", text: "Again" }),
  ).rejects.toThrow();
  const id = (await readFamily(db, viewer, now)).nominations[0].id;
  await act(viewer, { action: "vote", id });
  await expect(act(viewer, { action: "vote", id })).rejects.toThrow();
});
it("hides locked predictions including from their author, reveals at date", async () => {
  await act(owner, {
    action: "predict",
    text: "Secret forecast",
    revealAt: "2026-09-20",
  });
  expect(JSON.stringify(await readFamily(db, owner, now))).not.toContain(
    "Secret forecast",
  );
  expect(
    (await readFamily(db, viewer, new Date("2026-09-21"))).predictions[0].text,
  ).toBe("Secret forecast");
  await expect(act(owner, { action: "predict", text: "Past", revealAt: "2026-09-17" }),
  ).rejects.toThrow();
});
it("keeps goal contributions in an independent ledger", async () => {
  await act(owner, { action: "goal", text: "Holiday", target: 1000 });
  const id = (await readFamily(db, owner, now)).goals[0].id;
  await act(viewer, { action: "contribute", id, amount: 25 });
  await act(owner, { action: "contribute", id, amount: 30 });
  expect((await readFamily(db, owner, now)).goals[0].saved).toBe(55);
  await expect(act(viewer, { action: "contribute", id, amount: -2 })).rejects.toThrow();
});
it("paper challenge is owner-created, equal funded and cannot overspend or sell absent shares", async () => {
  await expect(act(viewer, { action: "challenge", text: "Autumn", endsAt: "2026-10-18" }),
  ).rejects.toThrow();
  await act(owner, { action: "challenge", text: "Autumn", endsAt: "2026-10-18" });
  await act(viewer, { action: "join" });
  await act(owner, { action: "join" });
  const quote = {
    price: 100,
    source: "moomoo",
    dataTimestamp: now.toISOString(),
  };
  await familyAction(
    db,
    viewer,
    { action: "trade", symbol: "AAPL", side: "buy", quantity: 10 },
    now,
    quote,
  );
  expect(
    (await readFamily(db, viewer, now)).challenge?.members.find((m) => m.userId === "v")
      ?.cash,
  ).toBe(9000);
  await expect(familyAction(
      db,
      viewer,
      { action: "trade", symbol: "AAPL", side: "buy", quantity: 1000 },
      now,
      quote,
    ),
  ).rejects.toThrow();
  await expect(familyAction(
      db,
      viewer,
      { action: "trade", symbol: "AAPL", side: "sell", quantity: 11 },
      now,
      quote,
    ),
  ).rejects.toThrow();
  await expect(familyAction(
      db,
      viewer,
      { action: "trade", symbol: "AAPL", side: "buy", quantity: 1 },
      new Date("2026-11-01"),
      quote,
    ),
  ).rejects.toThrow();
  await expect(act(viewer, {
      action: "trade",
      symbol: "AAPL",
      side: "buy",
      quantity: 1,
      price: 1,
    }),
  ).rejects.toThrow();
});
it("rejects sub-cent contributions and invalid dates", async () => {
  await act(owner, { action: "goal", text: "Trip", target: 100 });
  const id = (await readFamily(db, owner, now)).goals[0].id;
  await expect(act(viewer, { action: "contribute", id, amount: 0.001 }),
  ).rejects.toThrow();
  await expect(act(owner, { action: "predict", text: "Invalid", revealAt: "2026-02-31" }),
  ).rejects.toThrow();
});
it("rejects stale and mock prices without changing balances", async () => {
  await act(owner, { action: "challenge", text: "Challenge", endsAt: "2026-10-18" });
  await act(viewer, { action: "join" });
  for (const quote of [
    { price: 10, source: "mock", dataTimestamp: now.toISOString() },
    { price: 10, source: "moomoo", dataTimestamp: "2026-09-17T12:00:00Z" },
  ])
    await expect(familyAction(
        db,
        viewer,
        { action: "trade", symbol: "AAPL", side: "buy", quantity: 1 },
        now,
        quote,
      ),
    ).rejects.toThrow();
  expect((await readFamily(db, viewer, now)).challenge?.members[0].cash).toBe(10000);
});
it("scores a quiz once per member each week", async () => {
  await act(viewer, { action: "quiz", answers: [1, 0, 2] });
  expect((await readFamily(db, viewer, now)).quiz?.score).toBe(3);
  await expect(act(viewer, { action: "quiz", answers: [0, 0, 0] })).rejects.toThrow();
  await act(viewer, { action: "quiz", answers: [0, 0, 0] }, new Date("2026-09-28"));
  expect((await readFamily(db, viewer, new Date("2026-09-28"))).quiz?.score).toBe(1);
});
it("rolls weekly voting independently and preserves old discussions", async () => {
  await act(owner, { action: "nominate", symbol: "AAPL", text: "First week" });
  const id = (await readFamily(db, owner, now)).nominations[0].id;
  await act(viewer, { action: "vote", id });
  const next = new Date("2026-09-28");
  await act(owner, { action: "nominate", symbol: "AAPL", text: "Next week" }, next);
  const n = (await readFamily(db, viewer, next)).nominations[0];
  await act(viewer, { action: "vote", id: n.id }, next);
  expect((await readFamily(db, viewer, next)).nominations[0].votes).toEqual(["v"]);
});
it("updates all virtual valuations from validated server quote observations", async () => {
  await act(owner, { action: "challenge", text: "Challenge", endsAt: "2026-10-18" });
  await act(viewer, { action: "join" });
  await familyAction(
    db,
    viewer,
    { action: "trade", symbol: "AAPL", side: "buy", quantity: 10 },
    now,
    { price: 100, source: "moomoo", dataTimestamp: now.toISOString() },
  );
  await familyAction(db, viewer, { action: "mark" }, now, undefined, [
    {
      symbol: "AAPL",
      price: 80,
      source: "moomoo",
      dataTimestamp: now.toISOString(),
    },
  ]);
  const m = (await readFamily(db, viewer, now)).challenge!.members[0];
  expect(m.value).toBe(9800);
  expect(m.observedDrawdown).toBeCloseTo(-2);
});
it("stores a bounded local goal photo and rejects remote or unsafe image data", async () => {
  await act(owner, {
    action: "goal",
    text: "Trip",
    target: 500,
    imageData: "data:image/png;base64,iVBORw0KGgo=",
  });
  expect((await readFamily(db, owner, now)).goals[0].imageData).toBe(
    "data:image/png;base64,iVBORw0KGgo=",
  );
  await expect(act(owner, {
      action: "goal",
      text: "Trip",
      target: 500,
      imageData: "https://example.com/image.jpg",
    }),
  ).rejects.toThrow();
});
it("keeps the learning rationale alongside a virtual trade", async () => {
  await act(owner, { action: "challenge", text: "Challenge", endsAt: "2026-10-18" });
  await act(viewer, { action: "join" });
  await familyAction(
    db,
    viewer,
    {
      action: "trade",
      symbol: "AAPL",
      side: "buy",
      quantity: 1,
      reason: "I want to learn about its services business.",
    },
    now,
    { price: 100, source: "moomoo", dataTimestamp: now.toISOString() },
  );
  expect(
    (await readFamily(db, viewer, now)).challenge!.members[0].trades[0].reason,
  ).toContain("services business");
});

it("preserves full option symbols in holding conversations", async () => {
  await act(owner, {
    action: "post",
    text: "Our option question",
    symbol: "AAPL260918C00150000",
  });
  expect((await readFamily(db, owner, now)).posts[0].symbol).toBe(
    "AAPL260918C00150000",
  );
});

it("loses no post when several family members write at the same time", async () => {
  // The state is one JSON document that is read, edited and written back, so
  // overlapping writers each read the same version and the later write
  // discards the earlier post. Eight is enough to make the interleaving
  // reliable: without the advisory lock this keeps four.
  const WRITERS = 8;
  await Promise.all(
    Array.from({ length: WRITERS }, (_, i) =>
      familyAction(db, i % 2 ? owner : viewer, {
        action: "post",
        text: `post ${i}`,
      }, now),
    ),
  );

  const texts = (await readFamily(db, owner, now)).posts.map((p) => p.text);
  expect(texts).toHaveLength(WRITERS);
  expect(new Set(texts).size).toBe(WRITERS);
});
