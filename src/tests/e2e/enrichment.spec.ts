import { expect, test, type Page } from "@playwright/test";
async function login(page: Page, username = "owner") {
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(`e2e-${username}-pass`);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/dashboard");
}
async function post(page: Page, path: string, body: unknown) {
  return page.evaluate(
    async ({ path, body }) => {
      const r = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      return { status: r.status, data: await r.json() };
    },
    { path, body },
  );
}
test("owner can review flows and compare a sourced benchmark", async ({
  page,
}) => {
  await login(page);
  const history = await page.evaluate(
    async () => await (await fetch("/api/portfolio/history")).json(),
  );
  const rows = history.snapshots ?? history.history ?? history;
  expect(Array.isArray(rows)).toBeTruthy();
  const from = rows[0].snapshotDate,
    to = rows.at(-1).snapshotDate;
  await page.goto("/performance");
  await page.getByText("Manage analysis data", { exact: true }).click();
  await page.getByLabel("From", { exact: true }).fill(from);
  await page.getByLabel("Through", { exact: true }).fill(to);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Confirm reviewed period" }).click();
  await expect(page.getByText("Growth of 100", { exact: true })).toBeVisible();
  await page
    .getByLabel("Source and series name")
    .fill("E2E synthetic total-return index, USD");
  await page
    .getByLabel("CSV: date,value")
    .fill(`date,value\n${from},100\n${to},105`);
  await page.getByRole("button", { name: "Import observations" }).click();
  await expect(
    page.getByText("Comparable growth", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Options payoff explorer" }),
  ).toBeVisible();
  const range = page.getByRole("slider");
  await range.fill("100");
  await expect(range).toHaveValue("100");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBeTruthy();
});
test("a failed watchlist deletion keeps the entry and unlocks the button", async ({
  page,
}) => {
  await login(page);
  await post(page, "/api/watchlist", {
    symbol: "AAPL",
    reason: "A persistent family idea",
    name: "Apple",
  });
  await post(page, "/api/watchlist", {
    symbol: "AAPL",
    reason: "A second preserved contribution",
    name: "Apple",
  });
  await page.goto("/watchlist");
  await expect(
    page.getByText("A second preserved contribution").first(),
  ).toBeVisible();
  await page.route("**/api/watchlist?symbol=AAPL", async (route) =>
    route.fulfill({
      status: 500,
      contentType: "application/json",
      body: JSON.stringify({ error: "Temporary failure; please retry" }),
    }),
  );
  const card = page
    .getByRole("listitem")
    .filter({
      has: page.getByText("A persistent family idea", { exact: true }),
    })
    .first();
  await card.getByRole("button", { name: "Remove", exact: true }).click();
  await expect(page.getByText("Temporary failure; please retry")).toBeVisible();
  await expect(
    card.getByRole("button", { name: "Remove", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByText("A persistent family idea", { exact: true }).first(),
  ).toBeVisible();
});
test("viewer cannot edit analysis or delete family watchlist entries", async ({
  page,
}) => {
  await login(page, "father");
  expect(
    (
      await post(page, "/api/analysis", {
        action: "review",
        from: "2026-01-01",
        to: "2026-01-02",
      })
    ).status,
  ).toBe(403);
  const status = await page.evaluate(
    async () =>
      (await fetch("/api/watchlist?symbol=AAPL", { method: "DELETE" })).status,
  );
  expect(status).toBe(403);
  await page.goto("/performance");
  await expect(
    page.getByText("Manage analysis data", { exact: true }),
  ).toHaveCount(0);
});
test("new data APIs require authentication and the scheduler requires its own secret", async ({
  request,
}) => {
  for (const path of ["/api/analysis", "/api/family"])
    expect((await request.get(path)).status()).toBe(401);
  expect(
    (
      await request.post("/api/cron/snapshot", {
        headers: { Authorization: "Bearer wrong" },
      })
    ).status(),
  ).toBe(401);
});
