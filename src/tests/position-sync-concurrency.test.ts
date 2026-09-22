import { afterEach, beforeEach, expect, it } from "vitest";
import { createTestDb, TEST_PORTFOLIO_ID as PF, type TestDb } from "@/lib/db/testing";
import { readPositions, syncPositions } from "@/lib/portfolio/sync";
import { MockBrokerProvider } from "@/providers/broker/mock";
import { syncMockPositions } from "@/lib/portfolio/mock";
import { findById } from "@/lib/portfolios";

let db: TestDb;

beforeEach(async () => { db = await createTestDb(); });
afterEach(async () => { await db.close(); });

it.each([false, true])("overlapping refreshes keep one position set (existing=%s)", async (existing) => {
  const broker = new MockBrokerProvider();
  const expected = await broker.getPositions();
  if (existing) await syncPositions(db, PF, broker, "mock");

  // Widen the real database race, including the first sync of an empty account.
  // Separate pool connections model separate deployment instances.
  await db.exec(`
    CREATE FUNCTION slow_position_insert() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN PERFORM pg_sleep(0.025); RETURN NEW; END $$;
    CREATE TRIGGER slow_position_insert BEFORE INSERT ON positions
    FOR EACH ROW EXECUTE FUNCTION slow_position_insert();
  `);
  await Promise.all(Array.from({ length: 3 }, () => syncPositions(db, PF, broker, "mock")));

  const stored = await readPositions(db, PF);
  expect(stored).toHaveLength(expected.length);
  expect(stored.filter((p) => p.instrumentType === "cash").map((p) => p.quantity))
    .toEqual(expected.filter((p) => p.instrumentType === "cash").map((p) => p.quantity));
});

it("overlapping simulated-account refreshes keep one cash balance", async () => {
  const portfolio = { ...(await findById(db, PF))!, kind: "mock" as const, openingCash: "10000" };
  await db.exec(`
    CREATE FUNCTION slow_position_insert() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN PERFORM pg_sleep(0.1); RETURN NEW; END $$;
    CREATE TRIGGER slow_position_insert BEFORE INSERT ON positions
    FOR EACH ROW EXECUTE FUNCTION slow_position_insert();
  `);
  await Promise.all(Array.from({ length: 3 }, () => syncMockPositions(db, portfolio, new Map())));
  const positions = await readPositions(db, PF);
  expect(positions).toHaveLength(1);
  expect(positions[0].quantity).toBe(10000);
});
