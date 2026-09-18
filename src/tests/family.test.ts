import { beforeEach, expect, it } from "vitest";
import { createTestDb, type DB } from "@/lib/db";
import { familyAction, readFamily } from "@/lib/family/repository";
const owner = { id: "o", displayName: "Owner", role: "owner" as const };
const viewer = { id: "v", displayName: "Viewer", role: "viewer" as const };
let db: DB;
const now = new Date("2026-09-18T12:00:00Z");
beforeEach(() => {
  db = createTestDb();
});
const act = (
  user: typeof owner | typeof viewer,
  action: Record<string, unknown>,
  date = now,
) => familyAction(db, user, action, date);
it("preserves discussions, replies and reactions and enforces author deletion", () => {
  act(owner, { action: "post", text: "Our thoughts", symbol: "AAPL" });
  const id = readFamily(db, viewer, now).posts[0].id;
  act(viewer, { action: "reply", id, text: "Why this company?" });
  act(viewer, { action: "react", id, reaction: "explain" });
  expect(readFamily(db, viewer, now).posts[0].replies).toHaveLength(1);
  expect(() => act(viewer, { action: "deletePost", id })).toThrow();
  expect(readFamily(db, viewer, now).posts[0].unread).toBe(true);
  act(viewer, { action: "read" });
  expect(readFamily(db, viewer, now).posts[0].unread).toBe(false);
});
it("allows only one weekly vote per member and unique nominations", () => {
  act(owner, { action: "nominate", symbol: "AAPL", text: "Products we use" });
  expect(() =>
    act(viewer, { action: "nominate", symbol: "AAPL", text: "Again" }),
  ).toThrow();
  const id = readFamily(db, viewer, now).nominations[0].id;
  act(viewer, { action: "vote", id });
  expect(() => act(viewer, { action: "vote", id })).toThrow();
});
it("hides locked predictions including from their author, reveals at date", () => {
  act(owner, {
    action: "predict",
    text: "Secret forecast",
    revealAt: "2026-09-20",
  });
  expect(JSON.stringify(readFamily(db, owner, now))).not.toContain(
    "Secret forecast",
  );
  expect(
    readFamily(db, viewer, new Date("2026-09-21")).predictions[0].text,
  ).toBe("Secret forecast");
  expect(() =>
    act(owner, { action: "predict", text: "Past", revealAt: "2026-09-17" }),
  ).toThrow();
});
it("keeps goal contributions in an independent ledger", () => {
  act(owner, { action: "goal", text: "Holiday", target: 1000 });
  const id = readFamily(db, owner, now).goals[0].id;
  act(viewer, { action: "contribute", id, amount: 25 });
  act(owner, { action: "contribute", id, amount: 30 });
  expect(readFamily(db, owner, now).goals[0].saved).toBe(55);
  expect(() => act(viewer, { action: "contribute", id, amount: -2 })).toThrow();
});
it("paper challenge is owner-created, equal funded and cannot overspend or sell absent shares", () => {
  expect(() =>
    act(viewer, { action: "challenge", text: "Autumn", endsAt: "2026-10-18" }),
  ).toThrow();
  act(owner, { action: "challenge", text: "Autumn", endsAt: "2026-10-18" });
  act(viewer, { action: "join" });
  act(owner, { action: "join" });
  const quote = {
    price: 100,
    source: "moomoo",
    dataTimestamp: now.toISOString(),
  };
  familyAction(
    db,
    viewer,
    { action: "trade", symbol: "AAPL", side: "buy", quantity: 10 },
    now,
    quote,
  );
  expect(
    readFamily(db, viewer, now).challenge?.members.find((m) => m.userId === "v")
      ?.cash,
  ).toBe(9000);
  expect(() =>
    familyAction(
      db,
      viewer,
      { action: "trade", symbol: "AAPL", side: "buy", quantity: 1000 },
      now,
      quote,
    ),
  ).toThrow();
  expect(() =>
    familyAction(
      db,
      viewer,
      { action: "trade", symbol: "AAPL", side: "sell", quantity: 11 },
      now,
      quote,
    ),
  ).toThrow();
  expect(() =>
    familyAction(
      db,
      viewer,
      { action: "trade", symbol: "AAPL", side: "buy", quantity: 1 },
      new Date("2026-11-01"),
      quote,
    ),
  ).toThrow();
  expect(() =>
    act(viewer, {
      action: "trade",
      symbol: "AAPL",
      side: "buy",
      quantity: 1,
      price: 1,
    }),
  ).toThrow();
});
it("rejects sub-cent contributions and invalid dates", () => {
  act(owner, { action: "goal", text: "Trip", target: 100 });
  const id = readFamily(db, owner, now).goals[0].id;
  expect(() =>
    act(viewer, { action: "contribute", id, amount: 0.001 }),
  ).toThrow();
  expect(() =>
    act(owner, { action: "predict", text: "Invalid", revealAt: "2026-02-31" }),
  ).toThrow();
});
it("rejects stale and mock prices without changing balances", () => {
  act(owner, { action: "challenge", text: "Challenge", endsAt: "2026-10-18" });
  act(viewer, { action: "join" });
  for (const quote of [
    { price: 10, source: "mock", dataTimestamp: now.toISOString() },
    { price: 10, source: "moomoo", dataTimestamp: "2026-09-17T12:00:00Z" },
  ])
    expect(() =>
      familyAction(
        db,
        viewer,
        { action: "trade", symbol: "AAPL", side: "buy", quantity: 1 },
        now,
        quote,
      ),
    ).toThrow();
  expect(readFamily(db, viewer, now).challenge?.members[0].cash).toBe(10000);
});
it("scores a quiz once per member each week", () => {
  act(viewer, { action: "quiz", answers: [1, 0, 2] });
  expect(readFamily(db, viewer, now).quiz?.score).toBe(3);
  expect(() => act(viewer, { action: "quiz", answers: [0, 0, 0] })).toThrow();
  act(viewer, { action: "quiz", answers: [0, 0, 0] }, new Date("2026-09-28"));
  expect(readFamily(db, viewer, new Date("2026-09-28")).quiz?.score).toBe(1);
});
it("rolls weekly voting independently and preserves old discussions", () => {
  act(owner, { action: "nominate", symbol: "AAPL", text: "First week" });
  const id = readFamily(db, owner, now).nominations[0].id;
  act(viewer, { action: "vote", id });
  const next = new Date("2026-09-28");
  act(owner, { action: "nominate", symbol: "AAPL", text: "Next week" }, next);
  const n = readFamily(db, viewer, next).nominations[0];
  act(viewer, { action: "vote", id: n.id }, next);
  expect(readFamily(db, viewer, next).nominations[0].votes).toEqual(["v"]);
});
it("updates all virtual valuations from validated server quote observations", () => {
  act(owner, { action: "challenge", text: "Challenge", endsAt: "2026-10-18" });
  act(viewer, { action: "join" });
  familyAction(
    db,
    viewer,
    { action: "trade", symbol: "AAPL", side: "buy", quantity: 10 },
    now,
    { price: 100, source: "moomoo", dataTimestamp: now.toISOString() },
  );
  familyAction(db, viewer, { action: "mark" }, now, undefined, [
    {
      symbol: "AAPL",
      price: 80,
      source: "moomoo",
      dataTimestamp: now.toISOString(),
    },
  ]);
  const m = readFamily(db, viewer, now).challenge!.members[0];
  expect(m.value).toBe(9800);
  expect(m.observedDrawdown).toBeCloseTo(-2);
});
it("stores a bounded local goal photo and rejects remote or unsafe image data", () => {
  act(owner, {
    action: "goal",
    text: "Trip",
    target: 500,
    imageData: "data:image/png;base64,iVBORw0KGgo=",
  });
  expect(readFamily(db, owner, now).goals[0].imageData).toBe(
    "data:image/png;base64,iVBORw0KGgo=",
  );
  expect(() =>
    act(owner, {
      action: "goal",
      text: "Trip",
      target: 500,
      imageData: "https://example.com/image.jpg",
    }),
  ).toThrow();
});
it("keeps the learning rationale alongside a virtual trade", () => {
  act(owner, { action: "challenge", text: "Challenge", endsAt: "2026-10-18" });
  act(viewer, { action: "join" });
  familyAction(
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
    readFamily(db, viewer, now).challenge!.members[0].trades[0].reason,
  ).toContain("services business");
});

it("preserves full option symbols in holding conversations", () => {
  act(owner, {
    action: "post",
    text: "Our option question",
    symbol: "AAPL260918C00150000",
  });
  expect(readFamily(db, owner, now).posts[0].symbol).toBe(
    "AAPL260918C00150000",
  );
});
