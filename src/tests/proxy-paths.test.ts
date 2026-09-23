import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The middleware turns away anything without a session cookie, which is the
 * right default and exactly wrong for a scheduler: it has no cookie and never
 * will. A job added without its path listed here fails silently — the
 * scheduler sees a 401, assumes it is misconfigured, and the work never runs.
 *
 * That happened: /api/cron/orders shipped blocked, so resting orders would
 * never have been filled with nobody signed in. Reading the file is crude,
 * but importing the middleware pulls in the whole Next request pipeline for
 * what is really a list.
 */
const source = readFileSync(new URL("../proxy.ts", import.meta.url), "utf8");

describe("paths the middleware lets through", () => {
  it.each([
    "/api/cron/snapshot",
    "/api/cron/reconstruct",
    "/api/cron/orders",
    "/api/health",
  ])("allows %s, which carries its own credentials", (path) => {
    expect(source).toContain(`"${path}"`);
  });

  it("allows signing up and signing in, which happen before a session exists", () => {
    for (const path of ["/login", "/api/auth/login", "/register", "/api/auth/register"]) {
      expect(source).toContain(`"${path}"`);
    }
  });

  it("lists every cron route the app actually has", async () => {
    const { readdirSync } = await import("node:fs");
    const dir = new URL("../app/api/cron/", import.meta.url);
    for (const name of readdirSync(dir)) {
      expect(source).toContain(`"/api/cron/${name}"`);
    }
  });
});
