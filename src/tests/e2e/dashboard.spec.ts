import { expect, test, type Page } from "@playwright/test";

const OWNER = { username: "owner", password: "e2e-owner-pass" };
const VIEWER = { username: "father", password: "e2e-father-pass" };

async function signIn(page: Page, user: { username: string; password: string }) {
  await page.goto("/login");
  await page.getByLabel("Username").fill(user.username);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/dashboard");
}

/**
 * Issues the request from inside the page. Playwright's APIRequestContext will
 * not attach a Secure session cookie over plain HTTP, so it always reads as
 * unauthenticated; the browser's own fetch carries the real session.
 */
async function apiStatus(page: Page, path: string, method = "GET") {
  return page.evaluate(
    async ([p, m]) => (await fetch(p, { method: m })).status,
    [path, method] as const,
  );
}

test.describe("authentication", () => {
  test("redirects an unauthenticated visitor to the login page", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
  });

  test("never returns portfolio data to an unauthenticated API caller", async ({
    request,
  }) => {
    for (const path of [
      "/api/portfolio/positions",
      "/api/portfolio/summary",
      "/api/portfolio/history",
      "/api/me",
      "/api/admin/users",
    ]) {
      const response = await request.get(path);
      expect(response.status(), `${path} must not be public`).toBe(401);
      expect(await response.text()).not.toContain("AAPL");
    }
  });

  test("rejects a wrong password", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Username").fill("owner");
    await page.getByLabel("Password").fill("definitely-not-the-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    // Next's route announcer is also role="alert", so match the message itself.
    await expect(page.getByText("Invalid username or password")).toBeVisible();
    await expect(page).toHaveURL(/\/login$/);
  });

  test("has no signup route, even for a signed-in user", async ({ page }) => {
    await signIn(page, OWNER);
    const response = await page.goto("/signup");
    expect(response?.status()).toBe(404);
  });

  test("signs in and back out", async ({ page }) => {
    await signIn(page, OWNER);
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();

    await page.getByRole("button", { name: "Sign out" }).first().click();
    await page.waitForURL("**/login");

    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login$/);
  });
});

test.describe("dashboard", () => {
  test.beforeEach(async ({ page }) => signIn(page, OWNER));

  test("shows the portfolio headline figures", async ({ page }) => {
    await expect(page.getByRole("heading", { name: "Overview" })).toBeVisible();
    await expect(page.getByText("Portfolio value")).toBeVisible();
    await expect(page.getByText("Unrealized P&L").first()).toBeVisible();
    await expect(page.getByText("Total invested")).toBeVisible();
    await expect(page.getByText(/Last updated/)).toBeVisible();
  });

  test("renders allocation and concentration", async ({ page }) => {
    await expect(page.getByText("Portfolio allocation")).toBeVisible();
    await expect(page.getByText("Asset type")).toBeVisible();
    await expect(page.getByText("Concentration")).toBeVisible();
    await expect(page.getByText("Top 3 holdings")).toBeVisible();
  });

  test("carries no recommendation language", async ({ page }) => {
    const body = (await page.locator("body").innerText()).toLowerCase();
    for (const banned of ["buy", "sell", "hold rating", "price target", "recommend"]) {
      expect(body, `dashboard must not contain "${banned}"`).not.toContain(banned);
    }
  });
});

test.describe("holdings", () => {
  test.beforeEach(async ({ page }) => signIn(page, OWNER));

  test("lists every position", async ({ page }) => {
    await page.goto("/holdings");
    await expect(page.getByRole("heading", { name: "Holdings" })).toBeVisible();

    // Desktop renders a table and mobile a card list; only one is visible at a
    // time, so assert against whichever layout is actually on screen.
    for (const symbol of ["AAPL", "GOOGL", "VST", "RBLX"]) {
      await expect(
        page.getByText(symbol, { exact: true }).filter({ visible: true }).first(),
      ).toBeVisible();
    }
  });

  test("opens a position detail page with factual fields only", async ({ page }) => {
    await page.goto("/holdings/AAPL");

    await expect(page.getByRole("heading", { name: "AAPL" })).toBeVisible();
    await expect(page.getByText("Average cost")).toBeVisible();
    await expect(page.getByText("Market value").first()).toBeVisible();
    await expect(page.getByText("Portfolio weight")).toBeVisible();
    await expect(page.getByText("Price history")).toBeVisible();
  });

  test("shows option contract facts on an option position", async ({ page }) => {
    await page.goto("/holdings/AAPL270115C00200000");

    // "Expiration" is a substring of "Days to expiration", so match exactly.
    await expect(page.getByText("Strike", { exact: true })).toBeVisible();
    await expect(page.getByText("Expiration", { exact: true })).toBeVisible();
    await expect(page.getByText("Days to expiration", { exact: true })).toBeVisible();
    await expect(page.getByText("Multiplier", { exact: true })).toBeVisible();
    await expect(page.getByText("Call / Put", { exact: true })).toBeVisible();
  });

  test("returns 404 for a symbol that is not held", async ({ page }) => {
    const response = await page.goto("/holdings/NOTHELD");
    expect(response?.status()).toBe(404);
  });
});

test.describe("roles", () => {
  test("a viewer cannot reach admin APIs or the settings page", async ({ page }) => {
    await signIn(page, VIEWER);

    expect(await apiStatus(page, "/api/admin/users")).toBe(403);
    expect(await apiStatus(page, "/api/portfolio/sync", "POST")).toBe(403);

    await expect(page.getByRole("link", { name: "Settings" })).toHaveCount(0);

    await page.goto("/settings");
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test("a viewer can still read the portfolio", async ({ page }) => {
    await signIn(page, VIEWER);
    expect(await apiStatus(page, "/api/portfolio/positions")).toBe(200);
    await expect(page.getByText("Portfolio value")).toBeVisible();
  });

  test("the owner can reach settings and sync", async ({ page }) => {
    await signIn(page, OWNER);
    await page.goto("/settings");

    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(page.getByText("Data source")).toBeVisible();

    expect(await apiStatus(page, "/api/admin/users")).toBe(200);
    expect(await apiStatus(page, "/api/portfolio/sync", "POST")).toBe(200);
  });

  test("the application exposes no trading endpoint", async ({ page }) => {
    await signIn(page, OWNER);

    for (const path of [
      "/api/trade",
      "/api/orders",
      "/api/broker/moomoo/trade",
      "/api/portfolio/positions/buy",
    ]) {
      expect(await apiStatus(page, path, "POST"), `${path} must not exist`).toBe(404);
    }
  });
});

test.describe("layout", () => {
  test("never scrolls horizontally", async ({ page }) => {
    await signIn(page, OWNER);

    for (const path of ["/dashboard", "/holdings", "/performance"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, `${path} overflows horizontally`).toBeLessThanOrEqual(1);
    }
  });
});
