import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb, TEST_PORTFOLIO_ID, type TestDb } from "@/lib/db/testing";
import { resetDbForTests } from "@/lib/db";
import { createPortfolio, grantAccess } from "@/lib/portfolios";
import { navSlug } from "@/lib/portfolios/nav-slug";
import type { AuthUser } from "@/lib/auth/session";

/**
 * "I open Carson's account and it jumps back to my own."
 *
 * The page loaded the account people chose; five seconds later the live
 * refresh asked the server for positions without saying whose, the server
 * answered with the caller's default — their practice account — and the
 * refresh replaced the page with it. The owner never saw it, because the
 * owner's default is the account being looked at.
 *
 * The same guess sat behind the navigation on pages without a portfolio in
 * their address, and behind the site root. These tests pin each one.
 */

const mocks = vi.hoisted(() => ({
  user: null as AuthUser | null,
  cookies: new Map<string, string>(),
  loaded: [] as string[],
}));

vi.mock("@/lib/auth/guards", () => ({
  getCurrentUser: async () => mocks.user,
  requireUser: async () => mocks.user,
  unauthorized: () => Response.json({ error: "Authentication required" }, { status: 401 }),
  forbidden: () => Response.json({ error: "Not permitted" }, { status: 403 }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      mocks.cookies.has(name) ? { value: mocks.cookies.get(name) } : undefined,
    set: (name: string, value: string) => void mocks.cookies.set(name, value),
  }),
}));
vi.mock("@/lib/portfolio/service", () => ({
  loadPortfolio: async (id: string) => {
    mocks.loaded.push(id);
    return { positions: [], summary: { portfolioId: id } };
  },
}));

import { GET as positions } from "@/app/api/portfolio/positions/route";
import { POST as viewing } from "@/app/api/me/viewing/route";

let db: TestDb;
let practiceId: string;

beforeEach(async () => {
  db = await createTestDb();
  resetDbForTests(db);
  mocks.cookies.clear();
  mocks.loaded = [];

  // Carson owns the real account; Mia has her own practice account and has
  // been let into Carson's. That combination is exactly who saw the bug.
  for (const id of ["carson", "mia"]) {
    await db.run(
      "INSERT INTO users (id,username,display_name,password_hash,role,created_at) VALUES (?,?,?,'hash','viewer',?)",
      [id, id, id, new Date().toISOString()],
    );
  }
  await db.run("UPDATE portfolios SET owner_user_id = 'carson' WHERE id = ?", [TEST_PORTFOLIO_ID]);
  practiceId = (
    await createPortfolio(db, {
      slug: "mia-practice",
      displayName: "Mia",
      ownerUserId: "mia",
      kind: "mock",
    })
  ).id;
  await grantAccess(db, TEST_PORTFOLIO_ID, "mia");

  mocks.user = { id: "mia", username: "mia", displayName: "Mia", role: "viewer", status: "active" };
});

afterEach(async () => {
  resetDbForTests(null);
  await db.close();
});

const get = (query: string) => positions(new Request(`http://localhost/api/portfolio/positions${query}`));

describe("an API call about a portfolio", () => {
  it("answers about the portfolio it names, not the caller's own", async () => {
    expect((await get("?portfolio=carson")).status).toBe(200);
    expect(mocks.loaded).toEqual([TEST_PORTFOLIO_ID]);
    expect(mocks.loaded).not.toContain(practiceId);
  });

  it("refuses to guess when it names none", async () => {
    // This was the bug: no name meant "yours", which for Mia is her practice
    // account. An error is loud; a wrong account on screen is not.
    const response = await get("");
    expect(response.status).toBe(400);
    expect(mocks.loaded).toEqual([]);
  });

  it("still asks for a session before anything else", async () => {
    mocks.user = null;
    expect((await get("")).status).toBe(401);
  });
});

describe("remembering which portfolio was opened", () => {
  const report = (slug: string | null) =>
    viewing(
      new Request(`http://localhost/api/me/viewing${slug ? `?portfolio=${slug}` : ""}`, {
        method: "POST",
      }),
    );

  it("remembers a portfolio the reader may open", async () => {
    expect((await report("carson")).status).toBe(204);
    expect(mocks.cookies.get("viewing")).toBe("carson");
  });

  it("does not remember one they may not", async () => {
    await db.run("DELETE FROM portfolio_access WHERE user_id = 'mia'");
    expect((await report("carson")).status).toBe(403);
    expect(mocks.cookies.has("viewing")).toBe(false);
  });

  it("refuses a report that names nothing", async () => {
    expect((await report(null)).status).toBe(400);
    expect(mocks.cookies.has("viewing")).toBe(false);
  });
});

describe("the navigation on pages with no portfolio in the address", () => {
  const visible = [{ slug: "carson" }, { slug: "mia-practice" }];

  it("keeps pointing at the account the reader was on", () => {
    // Starts from the server's default, which for Mia is her practice account.
    let last = "mia-practice";
    const trail = ["/carson", "/carson/holdings", "/playground", "/watchlist", "/account"].map(
      (path) => (last = navSlug(path, visible, last)),
    );
    expect(trail).toEqual(["carson", "carson", "carson", "carson", "carson"]);
  });

  it("moves only when the address does", () => {
    expect(navSlug("/mia-practice/trade", visible, "carson")).toBe("mia-practice");
    // A portfolio the reader cannot see is not a portfolio to point at.
    expect(navSlug("/somebody-else", visible, "carson")).toBe("carson");
  });
});

/**
 * The guard that makes it stay fixed.
 *
 * Every browser-side call to a route that answers about one portfolio must
 * say which. The list of such routes is read from the routes themselves —
 * anything calling requirePortfolioApi — so a new endpoint is covered the
 * day it is written, without anyone remembering to add it here.
 *
 * A URL built some other way (URLSearchParams, say) will trip this falsely.
 * Put `portfolio=` in the literal instead; a reader can then see it.
 */
describe("every browser call to a portfolio's data names the portfolio", () => {
  const src = join(dirname(fileURLToPath(import.meta.url)), "..");

  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return files(path);
      return /\.(ts|tsx)$/.test(name) ? [path] : [];
    });
  }

  const apiDir = join(src, "app", "api");
  const scoped = files(apiDir)
    .filter((file) => file.endsWith(`${sep}route.ts`))
    .filter((file) => readFileSync(file, "utf8").includes("requirePortfolioApi("))
    .map((file) => `/api/${relative(apiDir, dirname(file)).split(sep).join("/")}`);

  const patterns = scoped.map(
    (route) =>
      new RegExp(
        `^${route.replace(/\[[^\]]+\]/g, "__SEGMENT__").replace(/[.*+?^${}()|\\]/g, "\\$&").replace(/__SEGMENT__/g, "[^/?]+")}(?:[?/]|$)`,
      ),
  );

  /**
   * The old family room, which the playground replaced. It is not mounted
   * anywhere — checked below — so its unnamed calls reach no one. Should it
   * ever be mounted again, that check fails and this exemption goes.
   */
  const RETIRED = [join(src, "components", "family", "family-room.tsx")];

  const callers = files(src).filter(
    (file) =>
      !file.startsWith(apiDir + sep) &&
      !file.startsWith(join(src, "tests") + sep) &&
      !RETIRED.includes(file),
  );

  it("finds the routes it is guarding", () => {
    expect(scoped).toContain("/api/portfolio/positions");
    expect(scoped).toContain("/api/analysis");
    expect(scoped).toContain("/api/orders");
  });

  it("finds no call that leaves the portfolio out", () => {
    const offenders: string[] = [];
    for (const file of callers) {
      const source = readFileSync(file, "utf8");
      for (const match of source.matchAll(/[`"'](\/api\/[^`"']*)/g)) {
        const literal = match[1];
        // `${...}` stands for one path segment when matching the route.
        const path = literal.replace(/\$\{[^}]*\}/g, "x");
        if (!patterns.some((pattern) => pattern.test(path))) continue;
        if (!literal.includes("portfolio=")) {
          offenders.push(`${relative(src, file)}: ${literal}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the retired family room really is retired", () => {
    const importers = files(src).filter(
      (file) =>
        !RETIRED.includes(file) &&
        !file.startsWith(join(src, "tests") + sep) &&
        /from ["']@\/components\/family\/family-room["']/.test(readFileSync(file, "utf8")),
    );
    expect(importers).toEqual([]);
  });
});
