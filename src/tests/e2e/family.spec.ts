import { expect, test } from "@playwright/test";
test("family discussions, sealed predictions and demo trading work on this device", async ({
  page,
}, testInfo) => {
  await page.goto("/login");
  await page.getByLabel("Username").fill("owner");
  await page.getByLabel("Password").fill("e2e-owner-pass");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/dashboard");
  await page.goto("/family");
  const suffix = `${testInfo.project.name}-${Date.now()}`;
  await expect(
    page.getByRole("heading", { name: "Family Room", exact: true }),
  ).toBeVisible();
  const conversations = page.locator("section").filter({
    has: page.getByRole("heading", { name: "Conversations", exact: true }),
  });
  await conversations
    .getByLabel("Your question, idea, or weekly personal note")
    .fill(`Family note ${suffix}`);
  await conversations
    .getByRole("button", { name: "Start a conversation" })
    .click();
  await expect(
    conversations.getByText(`Family note ${suffix}`, { exact: true }),
  ).toBeVisible();
  const post = conversations
    .locator("article")
    .filter({ hasText: `Family note ${suffix}` });
  await post.getByLabel("Reply", { exact: true }).fill(`Reply ${suffix}`);
  await post.getByRole("button", { name: "Share", exact: true }).click();
  await expect(
    post.getByText(`Reply ${suffix}`, { exact: true }),
  ).toBeVisible();
  await post.getByRole("button", { name: /Interesting/ }).click();
  await expect(
    post.getByRole("button", { name: /Interesting/ }),
  ).toHaveAttribute("aria-pressed", "true");
  const capsule = page.locator("section").filter({
    has: page.getByRole("heading", {
      name: "Prediction time capsules",
      exact: true,
    }),
  });
  await capsule
    .getByLabel("What do you predict, and why?")
    .fill(`Secret ${suffix}`);
  await capsule.getByLabel("Reveal date (UTC)").fill("2099-01-01");
  await capsule.getByRole("button", { name: "Lock prediction" }).click();
  await expect(
    capsule.getByText("Sealed until 2099-01-01").first(),
  ).toBeVisible();
  await expect(
    capsule.getByText(`Secret ${suffix}`, { exact: true }),
  ).toHaveCount(0);
  const challenge = page.locator("section").filter({
    has: page.getByRole("heading", {
      name: "Virtual portfolio challenge",
      exact: true,
    }),
  });
  if (
    await challenge
      .getByRole("button", { name: "Start challenge", exact: true })
      .count()
  ) {
    await challenge.getByLabel("Challenge name").fill(`Demo ${suffix}`);
    await challenge.getByLabel("End date (UTC)").fill("2099-01-01");
    await challenge
      .getByRole("button", { name: "Start challenge", exact: true })
      .click();
  }
  // Both projects share one server and database, so this may arrive with the
  // challenge already joined by the earlier run. Counting the join button
  // straight after starting the challenge raced the round trip: the button did
  // not exist yet, the click was skipped, and the failure surfaced later as a
  // missing trade form. Wait for whichever state this run is actually in.
  const join = challenge.getByRole("button", {
    name: "Join with $10,000",
    exact: true,
  });
  const ticker = challenge.getByLabel("Ticker", { exact: true });
  await expect(join.or(ticker).first()).toBeVisible();
  if (await join.count()) {
    await join.click();
    await expect(join).toHaveCount(0);
  }
  await expect(
    challenge.getByText(
      "Demo challenge — synthetic prices, separate from live market challenges",
    ),
  ).toBeVisible();
  await expect(ticker).toBeVisible();
  await ticker.fill("AAPL");
  await challenge.getByLabel("Whole shares").fill("1");
  await challenge
    .getByRole("button", { name: "Place virtual trade", exact: true })
    .click();
  await expect(
    challenge.getByRole("button", { name: "Place virtual trade", exact: true }),
  ).toBeEnabled();
  await expect(page.locator("main").getByRole("alert")).toHaveCount(0);
  const goals = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", {
        name: "Our savings goals",
        exact: true,
      }),
    });
  await goals
    .getByLabel("What are we saving for?")
    .fill(`Family trip ${suffix}`);
  await goals.getByLabel("Target (USD)").fill("100");
  await goals
    .getByLabel("Photo (optional, PNG/JPEG/WebP, up to 350 KB)")
    .setInputFiles({
      name: "goal.png",
      mimeType: "image/png",
      buffer: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aS1kAAAAASUVORK5CYII=",
        "base64",
      ),
    });
  await goals.getByRole("button", { name: "Create goal", exact: true }).click();
  const goal = goals
    .locator("article")
    .filter({ has: page.getByText(`Family trip ${suffix}`, { exact: true }) });
  await expect(
    goal.getByRole("img", { name: `Family trip ${suffix}` }),
  ).toBeVisible();
  await goal.getByLabel("Amount (USD)").fill("100");
  await goal.getByRole("button", { name: "Record contribution" }).click();
  await expect(
    goal.getByText("Goal reached — time to celebrate together!"),
  ).toBeVisible();
  const quiz = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", {
        name: "Three-minute learning quiz",
        exact: true,
      }),
    });
  if (await quiz.getByRole("button", { name: "Submit answers" }).count()) {
    await quiz.getByLabel("No, it is a deposit").check();
    await quiz.getByLabel("A small ownership stake").check();
    await quiz.getByLabel("Dependence on a single company").check();
    await quiz.getByRole("button", { name: "Submit answers" }).click();
  }
  await expect(quiz.getByText("Your score: 3/3")).toBeVisible();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBeTruthy();
  await page.screenshot({
    path: testInfo.outputPath("family-room.png"),
    fullPage: true,
  });
  await page.reload();
  await expect(
    conversations.getByText(`Family note ${suffix}`, { exact: true }),
  ).toBeVisible();
});
