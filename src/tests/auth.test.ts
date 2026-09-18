import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type DB } from "@/lib/db";
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
  revokeSession,
  validateSession,
  type UserRole,
} from "@/lib/auth/session";

let db: DB;

function addUser(role: UserRole, username: string, disabled = false): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO users (id, username, display_name, password_hash, role, created_at, disabled_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    username,
    username,
    "hash",
    role,
    new Date().toISOString(),
    disabled ? new Date().toISOString() : null,
  );
  return id;
}

beforeEach(() => {
  db = createTestDb();
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
  it("validates a freshly issued session and exposes the role", () => {
    const id = addUser("owner", "owner");
    const { token } = createSession(db, id);

    const user = validateSession(db, token);
    expect(user).toMatchObject({ id, username: "owner", role: "owner" });
  });

  it("stores only a digest, never the token itself", () => {
    const id = addUser("viewer", "father");
    const { token } = createSession(db, id);

    const row = db.prepare(`SELECT token_hash FROM sessions`).get() as {
      token_hash: string;
    };
    expect(row.token_hash).not.toBe(token);
    expect(row.token_hash).toHaveLength(64);
  });

  it("rejects a missing, unknown or empty token", () => {
    expect(validateSession(db, undefined)).toBeNull();
    expect(validateSession(db, "")).toBeNull();
    expect(validateSession(db, "not-a-real-token")).toBeNull();
  });

  it("rejects a revoked session", () => {
    const id = addUser("viewer", "mother");
    const { token } = createSession(db, id);
    revokeSession(db, token);
    expect(validateSession(db, token)).toBeNull();
  });

  it("rejects an expired session", () => {
    const id = addUser("viewer", "wife");
    const issued = new Date("2026-01-01T00:00:00Z");
    const { token } = createSession(db, id, issued);

    const wayLater = new Date("2026-06-01T00:00:00Z");
    expect(validateSession(db, token, wayLater)).toBeNull();
  });

  it("rejects a session belonging to a disabled account", () => {
    const id = addUser("viewer", "disabled-user", true);
    const { token } = createSession(db, id);
    expect(validateSession(db, token)).toBeNull();
  });

  it("revokes every session for one user and leaves others signed in", () => {
    const owner = addUser("owner", "owner");
    const viewer = addUser("viewer", "father");
    const a = createSession(db, owner).token;
    const b = createSession(db, owner).token;
    const other = createSession(db, viewer).token;

    expect(revokeAllSessionsForUser(db, owner)).toBe(2);
    expect(validateSession(db, a)).toBeNull();
    expect(validateSession(db, b)).toBeNull();
    expect(validateSession(db, other)).not.toBeNull();
  });
});

describe("login rate limiting", () => {
  it("allows attempts below the threshold", () => {
    for (let i = 0; i < MAX_FAILED_ATTEMPTS - 1; i++) {
      recordFailedAttempt(db, "owner");
    }
    expect(checkRateLimit(db, "owner").blocked).toBe(false);
  });

  it("blocks once the threshold is reached", () => {
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
      recordFailedAttempt(db, "owner");
    }
    const state = checkRateLimit(db, "owner");
    expect(state.blocked).toBe(true);
    expect(state.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("scopes the block to one account", () => {
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
      recordFailedAttempt(db, "owner");
    }
    expect(checkRateLimit(db, "father").blocked).toBe(false);
  });

  it("clears the counter after a successful sign-in", () => {
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
      recordFailedAttempt(db, "owner");
    }
    clearFailedAttempts(db, "owner");
    expect(checkRateLimit(db, "owner").blocked).toBe(false);
  });

  it("lets the cooldown lapse", () => {
    const old = new Date(Date.now() - 60 * 60_000);
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
      recordFailedAttempt(db, "owner", old);
    }
    expect(checkRateLimit(db, "owner").blocked).toBe(false);
  });
});
