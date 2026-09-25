import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/lib/db/testing";
import { RegistrationError, decideAccount, pendingAccounts, register } from "@/lib/accounts";
import { createSession, validateSession } from "@/lib/auth/session";
import { canRead, createPortfolio, findBySlug, visibleTo } from "@/lib/portfolios";
import { notificationsFor } from "@/lib/notifications";
import { registerSchema } from "@/lib/schemas";

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

    // It gets a session — that is what lets the waiting page greet them by
    // name and offer sign-out. What it does not get is `active`, which is
    // what every page and API guard insists on.
    const { token } = await createSession(db, id);
    expect((await validateSession(db, token))?.status).toBe("pending");
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
    expect(mine?.openingCash).toBe("50000");
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
    expect((await validateSession(db, token))?.status).toBe("declined");
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

describe("what a waiting account can reach", () => {
  it("holds a session, but is nobody as far as the app is concerned", async () => {
    await addOwner();
    const { id } = await register(db, CREDENTIALS);
    const { token } = await createSession(db, id);

    // It resolves — that is what lets the waiting page greet them by name.
    const user = await validateSession(db, token);
    expect(user?.status).toBe("pending");

    // And it is refused everywhere else, because every page and route funnels
    // through a guard that insists on an active account.
    expect(user && user.status === "active").toBe(false);
  });

  it("keeps a declined account signed-in-able but empty-handed", async () => {
    const owner = await addOwner();
    const { id } = await register(db, CREDENTIALS);
    await decideAccount(db, { userId: id, deciderId: owner, approve: false });

    const { token } = await createSession(db, id);
    const user = await validateSession(db, token);
    expect(user?.status).toBe("declined");
    expect(await findBySlug(db, "jane-mock")).toBeNull();
  });

  it("stops resolving once the account is disabled outright", async () => {
    await addOwner();
    const { id } = await register(db, CREDENTIALS);
    await db.run(`UPDATE users SET disabled_at = ? WHERE id = ?`, [
      new Date().toISOString(),
      id,
    ]);

    const { token } = await createSession(db, id);
    expect(await validateSession(db, token)).toBeNull();
  });
});

describe("what they are asked at sign-up", () => {
  it("keeps the referral and the reasons for whoever approves it", async () => {
    await addOwner();
    await register(db, {
      ...CREDENTIALS,
      referredBy: "Mile",
      reason: "I sit next to Mile at work and want to learn.",
      email: "sam@example.com",
    });

    const [waiting] = await pendingAccounts(db);
    expect(waiting.referredBy).toBe("Mile");
    expect(waiting.reason).toBe("I sit next to Mile at work and want to learn.");
    expect(waiting.email).toBe("sam@example.com");
  });

  it("puts the referral in the owner's notification, since it decides most of them", async () => {
    const owner = await addOwner();
    await register(db, { ...CREDENTIALS, referredBy: "Mile", reason: "Mile invited me." });

    const told = await notificationsFor(db, owner);
    expect(told[0].body).toContain("Mile");
  });

  it("accepts a sign-up with no reason, or a very short one", () => {
    // Required, at ten characters or more, it turned people away at the door.
    const base = {
      username: "newcomer",
      displayName: "New",
      password: "correct horse",
      passwordHint: "the horse",
    };
    expect(registerSchema.safeParse(base).success).toBe(true);
    expect(registerSchema.safeParse({ ...base, reason: "" }).success).toBe(true);
    expect(registerSchema.safeParse({ ...base, reason: "hi" }).success).toBe(true);
    // The password rule is unchanged.
    expect(registerSchema.safeParse({ ...base, password: "short" }).success).toBe(false);
  });

  it("still lists somebody who gave no reason", async () => {
    await addOwner();
    await register(db, CREDENTIALS);

    const [waiting] = await pendingAccounts(db);
    expect(waiting.reason).toBeNull();
    expect(waiting.username).toBe("jane");
  });
});

describe("one practice account each", () => {
  it("does not hand out a second one when approval happens twice", async () => {
    const owner = await addOwner();
    const { id } = await register(db, {
      username: "greedy",
      displayName: "Greedy",
      password: "correct horse battery",
      reason: "two please",
    });

    await decideAccount(db, { userId: id, deciderId: owner, approve: true });
    await decideAccount(db, { userId: id, deciderId: owner, approve: true });

    const mine = await db.all<{ slug: string }>(
      `SELECT slug FROM portfolios WHERE owner_user_id = ? AND kind = 'mock'`,
      [id],
    );
    expect(mine).toHaveLength(1);
  });

  it("does not add another when one already exists under a different name", async () => {
    const owner = await addOwner();
    const { id } = await register(db, {
      username: "renamed",
      displayName: "Renamed",
      password: "correct horse battery",
      reason: "already have one",
    });

    // An owner made them one by hand, at an address that is not
    // <username>-mock. Checking the address would miss this; checking the
    // person does not.
    await createPortfolio(db, {
      slug: "something-else",
      displayName: "Theirs",
      ownerUserId: id,
      kind: "mock",
      openingCash: "50000",
    });

    await decideAccount(db, { userId: id, deciderId: owner, approve: true });

    const mine = await db.all<{ slug: string }>(
      `SELECT slug FROM portfolios WHERE owner_user_id = ? AND kind = 'mock'`,
      [id],
    );
    expect(mine.map((p) => p.slug)).toEqual(["something-else"]);
  });

  it("starts them with enough to buy an option contract", async () => {
    const owner = await addOwner();
    const { id } = await register(db, {
      username: "newcomer",
      displayName: "Newcomer",
      password: "correct horse battery",
      reason: "hello",
    });
    await decideAccount(db, { userId: id, deciderId: owner, approve: true });

    const mine = await db.get<{ opening_cash: string }>(
      `SELECT opening_cash FROM portfolios WHERE owner_user_id = ? AND kind = 'mock'`,
      [id],
    );
    // A single contract on a $300 name is $30,000, which ten thousand could
    // never have covered.
    expect(Number(mine?.opening_cash)).toBeGreaterThanOrEqual(50_000);
  });
});

describe("the password hint", () => {
  it("is stored for somebody who signs up with one", async () => {
    const { id } = await register(db, {
      username: "hinted",
      displayName: "Hinted",
      password: "correct horse battery",
      reason: "hello there",
      passwordHint: "the comic about a horse",
    });

    const row = await db.get<{ password_hint: string | null }>(
      `SELECT password_hint FROM users WHERE id = ?`,
      [id],
    );
    expect(row?.password_hint).toBe("the comic about a horse");
  });

  it("refuses a hint that gives the password away", async () => {
    await expect(
      register(db, {
        username: "careless",
        displayName: "Careless",
        password: "sunflower2026",
        reason: "hello there",
        passwordHint: "it is Sunflower2026 obviously",
      }),
    ).rejects.toBeInstanceOf(RegistrationError);
  });

  it("leaves an account made without one with nothing, rather than inventing one", async () => {
    const { id } = await register(db, {
      username: "older",
      displayName: "Older",
      password: "correct horse battery",
      reason: "hello there",
    });

    const row = await db.get<{ password_hint: string | null }>(
      `SELECT password_hint FROM users WHERE id = ?`,
      [id],
    );
    expect(row?.password_hint).toBeNull();
  });
});
