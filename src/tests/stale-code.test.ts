import { describe, expect, it } from "vitest";
import { looksLikeStaleCode } from "@/lib/stale-code";

/**
 * What a tab running code from an older deployment looks like, per browser.
 *
 * These are the messages that reach the error screen when a phone has kept
 * the site open across a deploy. Each is cured by one reload and by nothing
 * else, so recognising them is what turns "the page froze" into "the page
 * flickered once".
 */
describe("recognising a tab left open across a deploy", () => {
  it.each([
    ["webpack", "ChunkLoadError: Loading chunk 482 failed."],
    ["Chrome", "TypeError: Failed to fetch dynamically imported module: https://x/_next/a.js"],
    ["Safari", "TypeError: Importing a module script failed."],
    ["Firefox", "TypeError: error loading dynamically imported module"],
    ["a server action from an old build", "Error: Failed to find Server Action \"7f3a\""],
    ["a navigation the old code cannot read", "An unexpected response was received from the server."],
  ])("recognises %s", (_, message) => {
    expect(looksLikeStaleCode(new Error(message))).toBe(true);
  });

  it("leaves a genuine failure alone, so it is shown rather than reloaded away", () => {
    expect(looksLikeStaleCode(new Error("No portfolio 1234"))).toBe(false);
    expect(looksLikeStaleCode(new Error("connect ETIMEDOUT"))).toBe(false);
  });

  it("copes with something that is not an error at all", () => {
    expect(looksLikeStaleCode(undefined)).toBe(false);
    expect(looksLikeStaleCode("ChunkLoadError")).toBe(true);
  });
});
