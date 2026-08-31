import { expect, test, type Page } from "@playwright/test";

/**
 * The real path: load the shelf, narrow to the flagship query, flip through
 * the matches, open a game. Runs against the shipped collection on both the
 * desktop and phone projects.
 */

async function expectNoConsoleErrors(page: Page, run: () => Promise<void>) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await run();
  expect(errors, "console errors").toEqual([]);
}

test("load, filter, flip, open", async ({ page, isMobile }) => {
  await expectNoConsoleErrors(page, async () => {
    await page.goto("/");
    await expect(page.getByTestId("result-count")).toContainText(/All \d+ games/);
    await expect(page.getByTestId("game-card").first()).toBeVisible();

    // Flagship query, one tap.
    await page.getByTestId("preset").filter({ hasText: "2 of us, co-op" }).click();
    await expect(page).toHaveURL(/platform=nes&players=2&mode=coop/);
    const count = page.getByTestId("result-count");
    await expect(count).toContainText(/^\d+ games/);
    await expect(count).toContainText("that could work");
    await expect(page.getByTestId("game-card").first()).toBeVisible();

    // Flip through the same set.
    await page.getByTestId(isMobile ? "flip-link-phone" : "flip-link").click();
    await expect(page).toHaveURL(/\/flip\?platform=nes&players=2&mode=coop/);
    const firstTitle = await page.getByTestId("flip-title").textContent();
    await expect(page.getByTestId("flip-counter")).toHaveText(/^1 \/ \d+$/);
    await page.getByTestId("flip-next").click();
    await expect(page.getByTestId("flip-counter")).toHaveText(/^2 \/ \d+$/);
    await expect(page.getByTestId("flip-title")).not.toHaveText(firstTitle!);
    await page.getByTestId("flip-surprise").click();
    await expect(page.getByTestId("flip-surprise")).toBeEnabled({ timeout: 5000 });

    // Open the game from the flip view.
    await page.getByRole("link", { name: /Details, screenshots/ }).click();
    await expect(page).toHaveURL(/\/game\//);
    await expect(page.getByTestId("game-title")).toBeVisible();
    await expect(page.getByTestId("facts")).toBeVisible();

    // Back returns to the filtered flip, not the bare shelf.
    await expect(page.getByTestId("back-link")).toHaveAttribute("href", /\/flip\?platform=nes/);
  });
});

test("view mode survives navigation and the URL is enough", async ({ page }) => {
  await page.goto("/?players=4");
  await expect(page.getByTestId("result-count")).not.toContainText(/All \d+ games/);
  await page.goto("/?view=list&tags=Shooter");
  await expect(page.getByTestId("list")).toBeVisible();
  await page.getByTestId("game-row").first().click();
  await expect(page.getByTestId("game-title")).toBeVisible();
  await page.getByTestId("back-link").click();
  await expect(page).toHaveURL(/view=list/);
  await expect(page.getByTestId("list")).toBeVisible();
});

test("opening a game and coming back keeps the shelf scroll position", async ({ page }) => {
  await page.goto("/?platform=nes");
  await page.getByTestId("game-card").nth(40).scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  const before = await page.evaluate(() => window.scrollY);
  expect(before).toBeGreaterThan(500);
  await page.getByTestId("game-card").nth(40).click();
  await expect(page.getByTestId("game-title")).toBeVisible();
  await page.getByTestId("back-link").click();
  await expect(page.getByTestId("result-count")).toBeVisible();
  await page.waitForTimeout(600);
  const after = await page.evaluate(() => window.scrollY);
  expect(Math.abs(after - before)).toBeLessThan(50);
});

test("an empty result explains itself and offers a way out", async ({ page }) => {
  await page.goto("/?players=4&mode=coop&tags=Puzzle&length=long&strict=1&q=zzqx");
  await expect(page.getByTestId("empty")).toBeVisible();
  await page.getByTestId("empty").getByRole("button", { name: /Clear search/ }).click();
  await expect(page).not.toHaveURL(/q=zzqx/);
});

test("filters open as a sheet and apply instantly", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("open-filters").click();
  await page.getByRole("button", { name: "Co-op", exact: true }).click();
  await expect(page).toHaveURL(/mode=coop/);
  await page.getByTestId("close-filters").click();
  await expect(page.getByTestId("result-count")).toContainText("games");
});

test("handheld-only games can be hidden", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("open-filters").click();
  await page.getByRole("checkbox", { name: /Hide handheld-only games/ }).check();
  await expect(page).toHaveURL(/handhelds=hide/);
  await page.getByTestId("close-filters").click();
  await expect(page.getByTestId("result-count")).toContainText("games");
});

test("platform sidebar lists the collection and filters the shelf", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("open-platforms").click();
  await expect(page.getByTestId("platform-sidebar")).toBeVisible();
  // "All" plus one button per platform in the collection (23). Update after an import.
  const platformButtons = page.getByRole("navigation", { name: "Game platforms" }).getByRole("button");
  await expect(platformButtons).toHaveCount(24);
  await expect(page.getByTestId("platform-all")).toBeVisible();
  await page.getByTestId("platform-ps5").click();
  await expect(page).toHaveURL(/platform=ps5/);
  await expect(page.getByTestId("result-count")).toContainText("games");

  await page.getByTestId("open-platforms").click();
  await expect(page.getByTestId("platform-ps5")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("platform-all").click();
  await expect(page).not.toHaveURL(/platform=/);
  await expect(page.getByTestId("result-count")).toContainText(/All \d+ games/);
});

test("tags can be added by hand and are filterable at once", async ({ page }) => {
  await page.goto("/?q=Contra&platform=nes");
  await page.getByTestId("game-card").first().click();
  await expect(page.getByTestId("game-title")).toHaveText("Contra");
  await page.getByTestId("edit-tags").click();
  await page.getByTestId("tag-input").fill("E2E run-and-gun");
  await page.getByTestId("tag-input").press("Enter");
  await expect(page.getByTestId("tag-editor").getByRole("link", { name: "E2E run-and-gun" })).toBeVisible();
  await page.goto("/?tags=E2E%20run-and-gun");
  await expect(page.getByTestId("result-count")).toContainText("1 game");
  // clean up
  await page.getByTestId("game-card").first().click();
  await page.getByTestId("edit-tags").click();
  await page.getByRole("button", { name: "Remove E2E run-and-gun" }).click();
  await expect(page.getByTestId("tag-editor").getByRole("link", { name: "E2E run-and-gun" })).toHaveCount(0);
});
