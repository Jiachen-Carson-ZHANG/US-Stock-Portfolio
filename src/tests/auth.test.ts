import { randomUUID } from "node:crypto";
import { vi } from "vitest";

// The guard reads the session cookie through next/headers, which has no
// request context under vitest.
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
}));
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type TestDb } from "@/lib/db/testing";
import { changePasswordSchema } from "@/lib/schemas";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import {
  MAX_FAILED_ATTEMPTS,
  checkRateLimit,
  clearFailedAttempts,
  recordFailedAttempt,
} from "@/lib/auth/rate-limit";
import {
  createSession,
  revokeAllSessionsForUser,
  revokeOtherSessionsForUser,
  revokeSession,
  validateSession,
  type UserRole,
} from "@/lib/auth/session";

let db: TestDb;

async function addUser(
  role: UserRole,
  username: string,
  disabled = false,
): Promise<string> {
  const id = randomUUID();
  await db.run(
    `INSERT INTO users (id, username, display_name, password_hash, role, created_at, disabled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      username,
      username,
      "hash",
      role,
      new Date().toISOString(),
      disabled ? new Date().toISOString() : null,
    ],
  );
  return id;
}

beforeEach(async () => {
  db = await createTestDb();
});

// Each test gets a throwaway schema; dropping it here keeps the database from
// accumulating one per test across a run.
afterEach(async () => {
  await db.close();
});

describe("password hashing", () => {
  it("verifies the correct password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword(hash, "correct horse battery staple")).toBe(true);
  });

  it("rejects the wrong password", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(await verifyPassword(hash, "wrong password")).toBe(false);
  });

  it("stores an Argon2id hash, never the plaintext", async () => {
    const hash = await hashPassword("plaintext-secret");
    expect(hash).toContain("$argon2id$");
    expect(hash).not.toContain("plaintext-secret");
  });

  it("salts, so identical passwords hash differently", async () => {
    expect(await hashPassword("same")).not.toBe(await hashPassword("same"));
  });

  it("returns false instead of throwing on a malformed hash", async () => {
    expect(await verifyPassword("not-a-hash", "whatever")).toBe(false);
  });
});

describe("sessions", () => {
  it("validates a freshly issued session and exposes the role", async () => {
    const id = await addUser("owner", "owner");
    const { token } = await createSession(db, id);

    const user = await validateSession(db, token);
    expect(user).toMatchObject({ id, username: "owner", role: "owner" });
  });

  it("stores only a digest, never the token itself", async () => {
    const id = await addUser("viewer", "father");
    const { token } = await createSession(db, id);

    const row = await db.get<{ token_hash: string }>(
      `SELECT token_hash FROM sessions`,
    );
    expect(row!.token_hash).not.toBe(token);
    expect(row!.token_hash).toHaveLength(64);
  });

  it("rejects a missing, unknown or empty token", async () => {
    expect(await validateSession(db, undefined)).toBeNull();
    expect(await validateSession(db, "")).toBeNull();
    expect(await validateSession(db, "not-a-real-token")).toBeNull();
  });

  it("rejects a revoked session", async () => {
    const id = await addUser("viewer", "mother");
    const { token } = await createSession(db, id);
    await revokeSession(db, token);
    expect(await validateSession(db, token)).toBeNull();
  });

  it("rejects an expired session", async () => {
    const id = await addUser("viewer", "wife");
    const issued = new Date("2026-01-01T00:00:00Z");
    const { token } = await createSession(db, id, issued);

    const wayLater = new Date("2026-06-01T00:00:00Z");
    expect(await validateSession(db, token, wayLater)).toBeNull();
  });

  it("rejects a session belonging to a disabled account", async () => {
    const id = await addUser("viewer", "disabled-user", true);
    const { token } = await createSession(db, id);
    expect(await validateSession(db, token)).toBeNull();
  });

  it("revokes every session for one user and leaves others signed in", async () => {
    const owner = await addUser("owner", "owner");
    const viewer = await addUser("viewer", "father");
    const a = (await createSession(db, owner)).token;
    const b = (await createSession(db, owner)).token;
    const other = (await createSession(db, viewer)).token;

    expect(await revokeAllSessionsForUser(db, owner)).toBe(2);
    expect(await validateSession(db, a)).toBeNull();
    expect(await validateSession(db, b)).toBeNull();
    expect(await validateSession(db, other)).not.toBeNull();
  });
});

describe("login rate limiting", () => {
  it("allows attempts below the threshold", async () => {
    for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i++) {
      await recordFailedAttempt(db, "owner");
    }
    expect((await checkRateLimit(db, "owner")).blocked).toBe(false);
  });

  it("blocks once the threshold is reached", async () => {
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
      await recordFailedAttempt(db, "owner");
    }
    const state = await checkRateLimit(db, "owner");
    expect(state.blocked).toBe(true);
    expect(state.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("scopes the block to one account", async () => {
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
      await recordFailedAttempt(db, "owner");
    }
    expect((await checkRateLimit(db, "father")).blocked).toBe(false);
  });

  it("clears the counter after a successful sign-in", async () => {
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
      await recordFailedAttempt(db, "owner");
    }
    await clearFailedAttempts(db, "owner");
    expect((await checkRateLimit(db, "owner")).blocked).toBe(false);
  });

  it("lets the cooldown lapse", async () => {
    const old = new Date(Date.now() - 60 * 60_000);
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
      await recordFailedAttempt(db, "owner", old);
    }
    expect((await checkRateLimit(db, "owner")).blocked).toBe(false);
  });
});

describe("login page without a database", () => {
  // The sign-in page is the one screen that must render when the database is
  // unreachable — a misconfigured DATABASE_URL otherwise turns every entry
  // point into a server error with nothing to act on.
  it("answers 'not signed in' from the cookie alone, without connecting", async () => {
    const { getCurrentUser } = await import("@/lib/auth/guards");
    const { resetDbForTests } = await import("@/lib/db");

    // Any connection attempt now throws, standing in for an unreachable server.
    resetDbForTests(null);
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgres://nobody@127.0.0.1:1/none";
    process.env.AUTH_MODE = "password";

    try {
      await expect(getCurrentUser()).resolves.toBeNull();
    } finally {
      if (previous === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous;
    }
  });
});

describe("revoking other sessions", () => {
  it("keeps the caller signed in and closes their other devices", async () => {
    const userId = await addUser("viewer", "mile");
    const phone = await createSession(db, userId);
    const laptop = await createSession(db, userId);
    const tablet = await createSession(db, userId);

    const revoked = await revokeOtherSessionsForUser(db, userId, laptop.token);

    expect(revoked).toBe(2);
    expect(await validateSession(db, laptop.token)).not.toBeNull();
    expect(await validateSession(db, phone.token)).toBeNull();
    expect(await validateSession(db, tablet.token)).toBeNull();
  });

  it("leaves other people's sessions alone", async () => {
    const mile = await addUser("viewer", "mile");
    const carson = await addUser("owner", "carson");
    const hers = await createSession(db, mile);
    const his = await createSession(db, carson);

    await revokeOtherSessionsForUser(db, mile, undefined);

    expect(await validateSession(db, hers.token)).toBeNull();
    expect(await validateSession(db, his.token)).not.toBeNull();
  });

  it("revokes every session when no token is spared", async () => {
    const userId = await addUser("viewer", "zizhe");
    const a = await createSession(db, userId);
    const b = await createSession(db, userId);

    expect(await revokeOtherSessionsForUser(db, userId, undefined)).toBe(2);
    expect(await validateSession(db, a.token)).toBeNull();
    expect(await validateSession(db, b.token)).toBeNull();
  });
});

describe("password change rules", () => {
  it("requires at least ten characters", () => {
    const short = changePasswordSchema.safeParse({
      currentPassword: "whatever",
      newPassword: "short1",
    });
    expect(short.success).toBe(false);

    const ok = changePasswordSchema.safeParse({
      currentPassword: "whatever",
      newPassword: "a-long-enough-one",
    });
    expect(ok.success).toBe(true);
  });

  it("rejects an empty current password", () => {
    const parsed = changePasswordSchema.safeParse({
      currentPassword: "",
      newPassword: "a-long-enough-one",
    });
    expect(parsed.success).toBe(false);
  });

  it("changing a password does not make the old one work", async () => {
    const first = await hashPassword("original-password");
    const second = await hashPassword("replacement-password");

    expect(await verifyPassword(first, "original-password")).toBe(true);
    expect(await verifyPassword(second, "original-password")).toBe(false);
    expect(await verifyPassword(second, "replacement-password")).toBe(true);
  });
});
