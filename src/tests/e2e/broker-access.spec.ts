import { expect, test } from "@playwright/test";

test("a signed-in viewer can refresh but cannot change another account's broker", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Username").fill("father");
  await page.getByLabel("Password", { exact: true }).fill("e2e-father-pass");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/carson");
  await page.goto("/carson/connection");
  await expect(page.getByText("Only this portfolio's owner can connect or disconnect a brokerage here.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Connect moomoo", exact: true })).toHaveCount(0);
  const results = await page.evaluate(async () => {
    const paths = ["/api/portfolio/sync?portfolio=carson", "/api/broker/moomoo/connect?portfolio=carson", "/api/broker/moomoo/disconnect?portfolio=carson"];
    return Promise.all(paths.map(async (path) => (await fetch(path, { method: "POST" })).status));
  });
  expect(results).toEqual([200, 403, 403]);
});

test("an account owner can reach connection controls without exposing credentials", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Username").fill("owner");
  await page.getByLabel("Password", { exact: true }).fill("e2e-owner-pass");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/carson");
  await page.goto("/carson/connection");
  await expect(page.getByRole("button", { name: "Connect moomoo", exact: true })).toBeVisible();
  await expect(page.getByText("Whoever runs this server can read your portfolio.", { exact: false })).toBeVisible();
  await expect(page.locator('input[type="password"]')).toHaveCount(0);
});
