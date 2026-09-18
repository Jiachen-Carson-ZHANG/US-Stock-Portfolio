import { describe, expect, it } from "vitest";
import { decrypt, encrypt, generateKey, parseKey, safeEqual } from "@/lib/crypto";

const key = parseKey(generateKey());

describe("AES-256-GCM token encryption", () => {
  it("round-trips a refresh token", () => {
    const secret = "moomoo-refresh-token-value";
    expect(decrypt(encrypt(secret, key), key)).toBe(secret);
  });

  it("never emits the plaintext in the stored payload", () => {
    const payload = encrypt("super-secret-token", key);
    expect(JSON.stringify(payload)).not.toContain("super-secret-token");
    expect(payload.iv).toBeTruthy();
    expect(payload.authTag).toBeTruthy();
  });

  it("uses a fresh IV per encryption", () => {
    const a = encrypt("same", key);
    const b = encrypt("same", key);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("rejects tampered ciphertext", () => {
    const payload = encrypt("value", key);
    const flipped = Buffer.from(payload.ciphertext, "base64");
    flipped[0] ^= 0xff;
    expect(() =>
      decrypt({ ...payload, ciphertext: flipped.toString("base64") }, key),
    ).toThrow();
  });

  it("rejects a tampered auth tag", () => {
    const payload = encrypt("value", key);
    const tag = Buffer.from(payload.authTag, "base64");
    tag[0] ^= 0xff;
    expect(() => decrypt({ ...payload, authTag: tag.toString("base64") }, key)).toThrow();
  });

  it("rejects the wrong key", () => {
    const payload = encrypt("value", key);
    expect(() => decrypt(payload, parseKey(generateKey()))).toThrow();
  });

  it("rejects a key of the wrong length", () => {
    expect(() => parseKey(Buffer.alloc(16).toString("base64"))).toThrow(/32 bytes/);
  });

  it("compares strings without leaking length mismatch as a throw", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abd")).toBe(false);
    expect(safeEqual("abc", "abcd")).toBe(false);
  });
});
