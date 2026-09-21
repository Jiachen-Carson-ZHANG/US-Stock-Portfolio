import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "@/lib/logger";

let lines: string[];

beforeEach(() => {
  lines = [];
  const capture = (line: string) => void lines.push(line);
  vi.spyOn(console, "log").mockImplementation(capture);
  vi.spyOn(console, "warn").mockImplementation(capture);
  vi.spyOn(console, "error").mockImplementation(capture);
});

afterEach(() => {
  vi.restoreAllMocks();
});

const logged = () => lines.join("\n");

describe("secret field names", () => {
  it("drops a field whose name marks it secret, whatever the casing", () => {
    logger.info("test", {
      password: "hunter2-and-then-some",
      refreshToken: "abc",
      REFRESH_TOKEN: "def",
      "auth-tag": "ghi",
      apiKey: "jkl",
    });

    expect(logged()).not.toContain("hunter2");
    for (const value of ["abc", "def", "ghi", "jkl"]) {
      expect(logged()).not.toContain(`"${value}"`);
    }
  });

  it("keeps the fields that make a log line useful", () => {
    logger.info("auth.login.success", { username: "mile", attempts: 2 });
    expect(logged()).toContain("mile");
    expect(logged()).toContain("auth.login.success");
  });
});

describe("secret-shaped values", () => {
  // The case that field names cannot catch: a provider quoting the request it
  // rejected, inside a field called something innocuous like "reason".
  it("redacts a credential quoted inside an error message", () => {
    logger.error("broker.token.refresh_failed", {
      reason:
        "401 invalid_grant for refresh_token=ya29.A0ARrdaM9xKlPqRsTuVwXyZ0123456789abcdef",
    });

    expect(logged()).not.toContain("ya29.A0ARrdaM9xKlPqRsTuVwXyZ0123456789abcdef");
    expect(logged()).toContain("[redacted]");
    expect(logged()).toContain("invalid_grant");
  });

  it("redacts a bearer header echoed back to us", () => {
    logger.error("broker.sync.failure", {
      reason: "request failed: Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0",
    });
    expect(logged()).not.toContain("eyJhbGciOiJIUzI1NiJ9");
  });

  it("leaves ordinary words and numbers alone", () => {
    logger.info("broker.sync.success", {
      provider: "moomoo",
      positions: 23,
      reason: "connection reset by peer after 30 seconds",
    });
    expect(logged()).toContain("connection reset by peer after 30 seconds");
    expect(logged()).not.toContain("[redacted]");
  });

  it("does not redact an option symbol or a ticker", () => {
    logger.info("watchlist.added", { symbol: "GOOGL270319C350000", by: "carson" });
    expect(logged()).toContain("GOOGL270319C350000");
  });
});

describe("what redaction must not eat", () => {
  // This exact case cost an afternoon: a unique-constraint violation came
  // back as `violates unique constraint "[redacted]"`, which named nothing.
  it("keeps a database identifier in an error message", () => {
    logger.error("broker.connect.failure", {
      reason:
        'duplicate key value violates unique constraint "idx_broker_connection_portfolio"',
    });
    expect(logged()).toContain("idx_broker_connection_portfolio");
  });

  it("still redacts a credential of the same length", () => {
    logger.error("broker.connect.failure", {
      reason: "rejected token b7f3a91c04de55219a8c6f0e3d47bb12",
    });
    expect(logged()).not.toContain("b7f3a91c04de55219a8c6f0e3d47bb12");
  });
});
