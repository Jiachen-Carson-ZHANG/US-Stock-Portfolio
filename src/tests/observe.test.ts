import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/lib/db/testing";
import { currentSpan, timed } from "@/lib/observe/span";

let db: TestDb;

beforeEach(async () => {
  db = await createTestDb();
});

afterEach(async () => {
  await db.close();
});

describe("where a request's time goes", () => {
  it("adds up the time spent in each bucket", async () => {
    const span = { db: 0, broker: 0 };

    await currentSpan.run(span, async () => {
      await timed("db", () => new Promise((r) => setTimeout(r, 30)));
      await timed("broker", () => new Promise((r) => setTimeout(r, 50)));
    });

    expect(span.db).toBeGreaterThanOrEqual(25);
    expect(span.broker).toBeGreaterThanOrEqual(45);
  });

  it("still counts time that ended in a failure", async () => {
    // A breakdown that only counted successes would make a broker that times
    // out and throws look instant, which is exactly backwards.
    const span = { db: 0, broker: 0 };

    await currentSpan.run(span, async () => {
      await timed("broker", async () => {
        await new Promise((r) => setTimeout(r, 40));
        throw new Error("moomoo said no");
      }).catch(() => {});
    });

    expect(span.broker).toBeGreaterThanOrEqual(35);
  });

  it("runs the work unchanged when nothing is measuring", async () => {
    // Scripts and cron jobs call the same code outside any request.
    await expect(timed("db", async () => "fine")).resolves.toBe("fine");
  });

  it("keeps one request's time out of another's", async () => {
    const a = { db: 0, broker: 0 };
    const b = { db: 0, broker: 0 };

    await Promise.all([
      currentSpan.run(a, () => timed("db", () => new Promise((r) => setTimeout(r, 60)))),
      currentSpan.run(b, () => timed("db", () => new Promise((r) => setTimeout(r, 10)))),
    ]);

    expect(a.db).toBeGreaterThanOrEqual(50);
    expect(b.db).toBeLessThan(45);
  });
});
