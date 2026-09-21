import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, TEST_PORTFOLIO_ID, type TestDb } from "@/lib/db/testing";
import { decideRequest, pendingRequestsFor, requestAccess } from "@/lib/access";
import { notificationsFor, unreadCount, markRead } from "@/lib/notifications";
import { canRead, createPortfolio } from "@/lib/portfolios";
import type { AuthUser } from "@/lib/auth/session";

let db: TestDb;

async function addUser(username: string, role: "owner" | "viewer" = "viewer") {
  const id = randomUUID();
  await db.run(
    `INSERT INTO users (id, username, display_name, password_hash, role, created_at)
     VALUES (?, ?, ?, 'hash', ?, ?)`,
    [id, username, username, role, new Date().toISOString()],
  );
  return { id, username, displayName: username, role } satisfies AuthUser;
}

beforeEach(async () => {
  db = await createTestDb();
});

afterEach(async () => {
  await db.close();
});

describe("asking for access", () => {
  it("notifies the owner and appears in their queue", async () => {
    const mile = await addUser("mile");
    const dad = await addUser("father");
    const hers = await createPortfolio(db, {
      slug: "mirat",
      displayName: "Mile",
      ownerUserId: mile.id,
      kind: "broker",
    });

    await requestAccess(db, {
      portfolioId: hers.id,
      userId: dad.id,
      userName: dad.displayName,
      message: "Curious what you are holding",
    });

    expect(await unreadCount(db, mile.id)).toBe(1);
    const queue = await pendingRequestsFor(db, mile.id);
    expect(queue).toHaveLength(1);
    expect(queue[0].userName).toBe("father");
    expect(queue[0].message).toBe("Curious what you are holding");
  });

  it("does not pile up when someone asks twice", async () => {
    const mile = await addUser("mile");
    const dad = await addUser("father");
    const hers = await createPortfolio(db, {
      slug: "mirat",
      displayName: "Mile",
      ownerUserId: mile.id,
      kind: "broker",
    });

    const first = await requestAccess(db, {
      portfolioId: hers.id,
      userId: dad.id,
      userName: dad.displayName,
    });
    const second = await requestAccess(db, {
      portfolioId: hers.id,
      userId: dad.id,
      userName: dad.displayName,
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(await unreadCount(db, mile.id)).toBe(1);
  });

  it("grants access on approval and tells the asker", async () => {
    const mile = await addUser("mile");
    const dad = await addUser("father");
    const hers = await createPortfolio(db, {
      slug: "mirat",
      displayName: "Mile",
      ownerUserId: mile.id,
      kind: "broker",
    });
    await requestAccess(db, {
      portfolioId: hers.id,
      userId: dad.id,
      userName: dad.displayName,
    });

    const queue = await pendingRequestsFor(db, mile.id);
    const result = await decideRequest(db, {
      requestId: queue[0].id,
      deciderId: mile.id,
      approve: true,
      isAdministrator: false,
    });

    expect(result.ok).toBe(true);
    expect(await canRead(db, dad, hers.id)).toBe(true);

    const told = await notificationsFor(db, dad.id);
    expect(told[0].kind).toBe("access_granted");
    expect(told[0].link).toBe("/mirat");
  });

  it("declines without granting, and still says so", async () => {
    const mile = await addUser("mile");
    const dad = await addUser("father");
    const hers = await createPortfolio(db, {
      slug: "mirat",
      displayName: "Mile",
      ownerUserId: mile.id,
      kind: "broker",
    });
    await requestAccess(db, {
      portfolioId: hers.id,
      userId: dad.id,
      userName: dad.displayName,
    });

    const queue = await pendingRequestsFor(db, mile.id);
    await decideRequest(db, {
      requestId: queue[0].id,
      deciderId: mile.id,
      approve: false,
      isAdministrator: false,
    });

    expect(await canRead(db, dad, hers.id)).toBe(false);
    expect((await notificationsFor(db, dad.id))[0].kind).toBe("access_declined");
  });

  // The decision belongs to whose money it is. An administrator runs the
  // deployment; that is not the same as owning the account.
  it("will not let an administrator answer for someone else", async () => {
    const mile = await addUser("mile");
    const admin = await addUser("carson", "owner");
    const dad = await addUser("father");
    const hers = await createPortfolio(db, {
      slug: "mirat",
      displayName: "Mile",
      ownerUserId: mile.id,
      kind: "broker",
    });
    await requestAccess(db, {
      portfolioId: hers.id,
      userId: dad.id,
      userName: dad.displayName,
    });

    const queue = await pendingRequestsFor(db, mile.id);
    const result = await decideRequest(db, {
      requestId: queue[0].id,
      deciderId: admin.id,
      approve: true,
      isAdministrator: true,
    });

    expect(result.ok).toBe(false);
    expect(await canRead(db, dad, hers.id)).toBe(false);
  });

  it("shows nothing in a queue that is not yours", async () => {
    const mile = await addUser("mile");
    const dad = await addUser("father");
    const hers = await createPortfolio(db, {
      slug: "mirat",
      displayName: "Mile",
      ownerUserId: mile.id,
      kind: "broker",
    });
    await requestAccess(db, {
      portfolioId: hers.id,
      userId: dad.id,
      userName: dad.displayName,
    });

    expect(await pendingRequestsFor(db, dad.id)).toEqual([]);
  });
});

describe("notifications", () => {
  it("marks one read without touching the rest, or anyone else's", async () => {
    const mile = await addUser("mile");
    const dad = await addUser("father");
    await createPortfolio(db, {
      slug: "mirat",
      displayName: "Mile",
      ownerUserId: mile.id,
      kind: "broker",
    });
    const mock = await createPortfolio(db, {
      slug: "father-mock",
      displayName: "Dad",
      ownerUserId: dad.id,
      kind: "mock",
      openingCash: "10000",
    });

    await requestAccess(db, {
      portfolioId: TEST_PORTFOLIO_ID,
      userId: dad.id,
      userName: dad.displayName,
    });
    await requestAccess(db, {
      portfolioId: mock.id,
      userId: mile.id,
      userName: mile.displayName,
    });

    expect(await unreadCount(db, dad.id)).toBe(1);
    const dads = await notificationsFor(db, dad.id);
    await markRead(db, dad.id, dads[0].id);

    expect(await unreadCount(db, dad.id)).toBe(0);
    // Marking the same id as someone else changes nothing.
    expect(await markRead(db, mile.id, dads[0].id)).toBe(0);
  });
});
