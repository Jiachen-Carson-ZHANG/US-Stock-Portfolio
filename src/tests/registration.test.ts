import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/lib/db/testing";
import { RegistrationError, decideAccount, pendingAccounts, register } from "@/lib/accounts";
import { createSession, validateSession } from "@/lib/auth/session";
import { canRead, findBySlug, visibleTo } from "@/lib/portfolios";
import { notificationsFor } from "@/lib/notifications";

let db: TestDb;

async function addOwner(username = "carson") {
  const id = randomUUID();
  await db.run(
    `INSERT INTO users (id, username, display_name, password_hash, role, created_at, status)
     VALUES (?, ?, ?, 'hash', 'owner', ?, 'active')`,
    [id, username, username, new Date().toISOString()],
  );
  return id;
}

const CREDENTIALS = {
  username: "jane",
  displayName: "Jane",
  password: "a-long-enough-password",
};

beforeEach(async () => {
  db = await createTestDb();
  // The family portfolio every new person is shown.
  await db.run(`UPDATE portfolios SET slug = 'carson' WHERE slug <> 'carson'`);
});

afterEach(async () => {
  await db.close();
});

describe("signing up", () => {
  it("creates an account that cannot do anything yet", async () => {
    await addOwner();
    const { id } = await register(db, CREDENTIALS);

    const row = await db.get<{ status: string }>(`SELECT status FROM users WHERE id = ?`, [id]);
    expect(row?.status).toBe("pending");

    // The decisive check: even holding a session, a pending account resolves
    // to nobody, so no page or route needs its own guard.
    const { token } = await createSession(db, id);
    expect(await validateSession(db, token)).toBeNull();
  });

  it("tells every owner that somebody is waiting", async () => {
    const owner = await addOwner();
    await register(db, CREDENTIALS);

    const told = await notificationsFor(db, owner);
    expect(told.some((n) => n.kind === "account_request")).toBe(true);
    expect((await pendingAccounts(db)).map((p) => p.username)).toEqual(["jane"]);
  });

  it("refuses a name already taken", async () => {
    await addOwner();
    await register(db, CREDENTIALS);
    await expect(register(db, CREDENTIALS)).rejects.toBeInstanceOf(RegistrationError);
  });

  // The username becomes a URL segment on approval, so it is constrained from
  // the start rather than discovered to be unusable later.
  it("refuses a name that would not survive a URL", async () => {
    await addOwner();
    for (const username of ["j", "jane doe", "1jane", "-jane", "a".repeat(40)]) {
      await expect(
        register(db, { ...CREDENTIALS, username }),
      ).rejects.toBeInstanceOf(RegistrationError);
    }
  });

  // Case is normalised rather than rejected, matching sign-in, which has
  // always treated "Father" and "father" as the same person.
  it("accepts a capitalised name and stores it lowercase", async () => {
    await addOwner();
    const { id } = await register(db, { ...CREDENTIALS, username: "Jane" });
    const row = await db.get<{ username: string }>(
      `SELECT username FROM users WHERE id = ?`,
      [id],
    );
    expect(row?.username).toBe("jane");
  });
});

describe("approving an account", () => {
  it("activates it, shares the family portfolio, and gives them a mock one", async () => {
    const owner = await addOwner();
    const { id } = await register(db, CREDENTIALS);

    expect((await decideAccount(db, { userId: id, deciderId: owner, approve: true })).ok).toBe(
      true,
    );

    const { token } = await createSession(db, id);
    const user = await validateSession(db, token);
    expect(user?.username).toBe("jane");

    const family = await findBySlug(db, "carson");
    expect(await canRead(db, user!, family!.id)).toBe(true);

    const mine = await findBySlug(db, "jane-mock");
    expect(mine?.kind).toBe("mock");
    expect(mine?.openingCash).toBe("10000");
    expect(mine?.ownerUserId).toBe(id);

    expect((await visibleTo(db, user!)).map((p) => p.slug).sort()).toEqual([
      "carson",
      "jane-mock",
    ]);
  });

  it("does not hand over anybody else's portfolio", async () => {
    const owner = await addOwner();
    const mile = randomUUID();
    await db.run(
      `INSERT INTO users (id, username, display_name, password_hash, role, created_at, status)
       VALUES (?, 'mile', 'Mile', 'hash', 'viewer', ?, 'active')`,
      [mile, new Date().toISOString()],
    );
    await db.run(
      `INSERT INTO portfolios (id, slug, display_name, owner_user_id, kind, base_currency, created_at)
       VALUES (?, 'mirat', 'Mile', ?, 'broker', 'USD', ?)`,
      [randomUUID(), mile, new Date().toISOString()],
    );

    const { id } = await register(db, CREDENTIALS);
    await decideAccount(db, { userId: id, deciderId: owner, approve: true });

    const { token } = await createSession(db, id);
    const user = await validateSession(db, token);
    expect((await visibleTo(db, user!)).map((p) => p.slug)).not.toContain("mirat");
  });

  it("tells the new person, with somewhere to go", async () => {
    const owner = await addOwner();
    const { id } = await register(db, CREDENTIALS);
    await decideAccount(db, { userId: id, deciderId: owner, approve: true });

    const told = await notificationsFor(db, id);
    expect(told[0].kind).toBe("account_approved");
    expect(told[0].link).toBe("/jane-mock");
  });

  it("leaves a declined account unable to sign in, and with nothing", async () => {
    const owner = await addOwner();
    const { id } = await register(db, CREDENTIALS);
    await decideAccount(db, { userId: id, deciderId: owner, approve: false });

    const { token } = await createSession(db, id);
    expect(await validateSession(db, token)).toBeNull();
    expect(await findBySlug(db, "jane-mock")).toBeNull();
  });

  it("answers a request that has already been decided", async () => {
    const owner = await addOwner();
    const { id } = await register(db, CREDENTIALS);
    await decideAccount(db, { userId: id, deciderId: owner, approve: true });

    const again = await decideAccount(db, { userId: id, deciderId: owner, approve: true });
    expect(again.ok).toBe(false);
  });
});
