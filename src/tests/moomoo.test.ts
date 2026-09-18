import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb, type DB } from "@/lib/db";
import { generateKey } from "@/lib/crypto";
import {
  authorizeUrl,
  createPkcePair,
  createState,
  writeScopesIn,
} from "@/lib/moomoo/oauth";
import { deriveContractMultiplier, parseSymbol } from "@/lib/moomoo/symbols";
import { parseJsonPreservingBigInts } from "@/lib/moomoo/client";
import {
  deleteConnection,
  markStatus,
  readConnection,
  readConnectionStatus,
  saveConnection,
  setAccountId,
} from "@/lib/moomoo/tokens";

describe("PKCE", () => {
  it("derives the challenge as base64url(sha256(verifier))", () => {
    const { verifier, challenge } = createPkcePair();
    const expected = createHash("sha256").update(verifier).digest("base64url");
    expect(challenge).toBe(expected);
  });

  it("produces a fresh verifier and state each time", () => {
    expect(createPkcePair().verifier).not.toBe(createPkcePair().verifier);
    expect(createState()).not.toBe(createState());
  });

  it("uses a high-entropy verifier", () => {
    expect(createPkcePair().verifier.length).toBeGreaterThanOrEqual(43);
  });
});

describe("scope enforcement", () => {
  // The user picks scopes on moomoo's own consent screen, so the only real
  // guarantee this app has is refusing a grant that carries write access.
  it("flags write scopes in a granted string", () => {
    expect(writeScopesIn("quote:read trade:read accid:123")).toEqual([]);
    expect(writeScopesIn("trade:read trade:write")).toEqual(["trade:write"]);
    expect(writeScopesIn("quote:write quote:read")).toEqual(["quote:write"]);
  });

  it("treats an empty grant as carrying no write access", () => {
    expect(writeScopesIn("")).toEqual([]);
  });
});

describe("authorize URL", () => {
  const url = new URL(
    authorizeUrl({
      clientId: "abc-123",
      challenge: "chal",
      redirectUri: "http://localhost:3000/api/broker/moomoo/callback",
      state: "st-1",
    }),
  );

  it("targets moomoo's confirm endpoint", () => {
    expect(url.origin).toBe("https://webapi.moomoo.com");
    expect(url.pathname).toBe("/oauth2/authorize/confirm");
  });

  it("carries the PKCE and OAuth parameters", () => {
    expect(url.searchParams.get("client_id")).toBe("abc-123");
    expect(url.searchParams.get("code_challenge")).toBe("chal");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("state")).toBe("st-1");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "http://localhost:3000/api/broker/moomoo/callback",
    );
  });

  it("never asks for a write scope", () => {
    expect(url.searchParams.get("scope")).not.toContain("write");
  });
});

describe("big integer JSON parsing", () => {
  // moomoo account IDs exceed Number.MAX_SAFE_INTEGER. JSON.parse rounds them
  // to a valid looking ID for an account that does not exist, which the API
  // then rejects with "No permission to access this account".
  it("keeps an oversized account id exact", () => {
    const parsed = parseJsonPreservingBigInts(
      '{"s":"ok","d":{"accounts":[{"account_id":283726804710975704}]}}',
    ) as { d: { accounts: { account_id: string }[] } };

    expect(parsed.d.accounts[0].account_id).toBe("283726804710975704");
  });

  it("shows why the raw parser cannot be used", () => {
    const naive = JSON.parse('{"account_id":283726804710975704}');
    expect(String(naive.account_id)).not.toBe("283726804710975704");
  });

  it("leaves ordinary numbers as numbers", () => {
    const parsed = parseJsonPreservingBigInts(
      '{"price":337,"volume":1876507,"listing_date":345445200000}',
    ) as Record<string, unknown>;

    expect(parsed.price).toBe(337);
    expect(parsed.volume).toBe(1876507);
    expect(parsed.listing_date).toBe(345445200000);
  });

  it("leaves strings untouched", () => {
    const parsed = parseJsonPreservingBigInts(
      '{"card":"1008256316165115","qty":"-1"}',
    ) as Record<string, unknown>;

    expect(parsed.card).toBe("1008256316165115");
    expect(parsed.qty).toBe("-1");
  });
});

describe("symbol parsing", () => {
  it("reads a plain US stock", () => {
    const parsed = parseSymbol("US.AAPL");
    expect(parsed).toMatchObject({
      market: "US",
      localCode: "AAPL",
      instrumentType: "stock",
    });
  });

  it("reads an option's terms out of the code", () => {
    expect(parseSymbol("US.AAPL270115C00200000")).toMatchObject({
      market: "US",
      localCode: "AAPL270115C00200000",
      instrumentType: "option",
      underlyingSymbol: "AAPL",
      optionType: "call",
      strike: 200,
      expirationDate: "2027-01-15",
    });
  });

  it("reads a put", () => {
    expect(parseSymbol("US.TSLA260320P00150000")).toMatchObject({
      instrumentType: "option",
      optionType: "put",
      strike: 150,
      expirationDate: "2026-03-20",
    });
  });

  it("handles a non-US market", () => {
    expect(parseSymbol("HK.00700")).toMatchObject({
      market: "HK",
      localCode: "00700",
      instrumentType: "stock",
    });
  });

  it("falls back to stock when there is no market prefix", () => {
    expect(parseSymbol("AAPL")).toMatchObject({
      market: "",
      localCode: "AAPL",
      instrumentType: "stock",
    });
  });
});

describe("contract multiplier", () => {
  // Hardcoding 100 silently misprices any contract that does not use it, so it
  // is derived from the broker's own market value instead.
  it("derives 100 from a standard option position", () => {
    expect(
      deriveContractMultiplier({ quantity: 2, price: 18.65, marketValue: 3730 }),
    ).toBe(100);
  });

  it("derives a non-standard multiplier", () => {
    expect(
      deriveContractMultiplier({ quantity: 1, price: 10, marketValue: 500 }),
    ).toBe(50);
  });

  it("falls back to 100 when the inputs cannot produce a ratio", () => {
    expect(deriveContractMultiplier({ quantity: 0, price: 5, marketValue: 0 })).toBe(100);
    expect(deriveContractMultiplier({ quantity: 2, price: 0, marketValue: 100 })).toBe(100);
    expect(
      deriveContractMultiplier({ quantity: 2, price: 5, marketValue: Number.NaN }),
    ).toBe(100);
  });
});

describe("token storage", () => {
  let db: DB;

  beforeEach(() => {
    process.env.TOKEN_ENCRYPTION_KEY = generateKey();
    db = createTestDb();
  });

  it("round-trips a refresh token", () => {
    saveConnection(db, {
      refreshToken: "refresh-abc",
      scope: "quote:read trade:read",
      accountId: "123456",
    });

    expect(readConnection(db)).toMatchObject({
      refreshToken: "refresh-abc",
      scope: "quote:read trade:read",
      accountId: "123456",
      status: "connected",
    });
  });

  it("stores the token as ciphertext, never plaintext", () => {
    saveConnection(db, {
      refreshToken: "super-secret-refresh",
      scope: "quote:read",
      accountId: null,
    });

    const row = db.prepare(`SELECT * FROM broker_connections`).get() as Record<
      string,
      unknown
    >;
    expect(JSON.stringify(row)).not.toContain("super-secret-refresh");
    expect(row.iv).toBeTruthy();
    expect(row.auth_tag).toBeTruthy();
  });

  it("never exposes the token through the status view", () => {
    saveConnection(db, {
      refreshToken: "secret",
      scope: "quote:read",
      accountId: null,
    });

    const status = readConnectionStatus(db);
    expect(status).not.toBeNull();
    expect(JSON.stringify(status)).not.toContain("secret");
    expect(status).not.toHaveProperty("refreshToken");
  });

  it("replaces the token on reconnect rather than duplicating the row", () => {
    saveConnection(db, { refreshToken: "first", scope: "quote:read", accountId: null });
    saveConnection(db, { refreshToken: "second", scope: "quote:read", accountId: null });

    const count = db
      .prepare(`SELECT COUNT(*) AS n FROM broker_connections`)
      .get() as { n: number };
    expect(count.n).toBe(1);
    expect(readConnection(db)?.refreshToken).toBe("second");
  });

  it("records an expired connection", () => {
    saveConnection(db, { refreshToken: "t", scope: "quote:read", accountId: null });
    markStatus(db, "expired");
    expect(readConnectionStatus(db)?.status).toBe("expired");
  });

  it("remembers the resolved account id", () => {
    saveConnection(db, { refreshToken: "t", scope: "quote:read", accountId: null });
    setAccountId(db, "987654");
    expect(readConnection(db)?.accountId).toBe("987654");
  });

  it("returns nothing once disconnected", () => {
    saveConnection(db, { refreshToken: "t", scope: "quote:read", accountId: null });
    deleteConnection(db);
    expect(readConnection(db)).toBeNull();
    expect(readConnectionStatus(db)).toBeNull();
  });

  it("cannot decrypt a token with a different key", () => {
    saveConnection(db, { refreshToken: "t", scope: "quote:read", accountId: null });
    process.env.TOKEN_ENCRYPTION_KEY = generateKey();
    expect(() => readConnection(db)).toThrow();
  });
});
