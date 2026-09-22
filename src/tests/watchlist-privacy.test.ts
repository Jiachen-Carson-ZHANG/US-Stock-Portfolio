import { afterEach, beforeEach, expect, it } from "vitest";
import { createTestDb, TEST_PORTFOLIO_ID, type TestDb } from "@/lib/db/testing";
import { addToWatchlist, readWatchlist, saveAiNote } from "@/lib/watchlist";
import { createPortfolio } from "@/lib/portfolios";
let db: TestDb;
beforeEach(async () => { db = await createTestDb(); });
afterEach(async () => { await db.close(); });
it("never exposes legacy or another portfolio's generated financial note", async () => {
  const other = await createPortfolio(db, { slug: "other", displayName: "Other", ownerUserId: null, kind: "broker" });
  await addToWatchlist(db, { symbol: "TEST", reason: "Shared idea", addedBy: "Family" });
  await db.run("UPDATE watchlist SET ai_note = ?", ["legacy private account value"]);
  await saveAiNote(db, TEST_PORTFOLIO_ID, "TEST", "first private account");
  await saveAiNote(db, other.id, "TEST", "second private account");
  expect((await readWatchlist(db))[0].aiNote).toBeNull();
  expect((await readWatchlist(db, TEST_PORTFOLIO_ID))[0].aiNote).toBe("first private account");
  expect((await readWatchlist(db, other.id))[0].aiNote).toBe("second private account");
  const appended = await addToWatchlist(db, { symbol: "TEST", reason: "Another shared idea", addedBy: "Other" });
  expect(appended.aiNote).toBeNull();
});
