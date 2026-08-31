import { expect, test, type Page } from "@playwright/test";

/**
 * Home (GAMEEXPLOR-0012): the front door. Rows of cover art built from the
 * shelf, each one a filter you can follow.
 *
 * Count-agnostic throughout — which rows the day's seed draws, and how many
 * games are in them, is the collection's business and changes daily.
 */

async function expectNoConsoleErrors(page: Page, run: () => Promise<void>) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  await run();
  expect(errors, "console errors").toEqual([]);
}

test("home → a row → a game", async ({ page }) => {
  await expectNoConsoleErrors(page, async () => {
    await page.goto("/");
    await expect(page.getByTestId("tonights-picks")).toBeVisible();
    const rows = page.getByTestId("home-row");
    expect(await rows.count()).toBeGreaterThanOrEqual(6);

    const row = rows.first();
    await expect(row.getByTestId("row-header")).toBeVisible();
    const cards = row.getByTestId("game-card");
    expect(await cards.count()).toBeGreaterThanOrEqual(8);

    await cards.first().click();
    await expect(page).toHaveURL(/\/game\//);
    await expect(page.getByTestId("game-title")).toBeVisible();
  });
});

test("home → a row header → the same games on the shelf", async ({ page }) => {
  await page.goto("/");
  // Any row but a series one, whose header goes to the series page instead.
  const row = page.locator('[data-testid="home-row"]:not([data-row-kind="series"])').first();
  const hrefs = await row.getByTestId("game-card").evaluateAll((els) => els.slice(0, 4).map((e) => e.getAttribute("href")!));
  expect(hrefs.length).toBe(4);
  await row.getByTestId("row-header").click();

  // A row *is* a filter: its header opens the shelf on that filter, and the
  // games the row showed are all in what comes back.
  await expect(page).toHaveURL(/\/shelf\?/);
  await expect(page.getByTestId("result-count")).toBeVisible();
  for (const href of hrefs) await expect(page.locator(`a[href="${href}"]`).first()).toBeAttached();
});

test("tonight's picks is on home and no longer on the shelf", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("tonights-picks")).toBeVisible();
  await page.goto("/shelf");
  await expect(page.getByTestId("result-count")).toBeVisible();
  await expect(page.getByTestId("tonights-picks")).toHaveCount(0);
});

test("a bookmarked shelf URL at / still lands on the shelf, filtered", async ({ page }) => {
  await page.goto("/?platform=nes&players=2&mode=coop");
  await expect(page).toHaveURL(/\/shelf\?platform=nes&players=2&mode=coop/);
  await expect(page.getByTestId("result-count")).toContainText(/games?/);
});

test("the rows are the same page after a reload", async ({ page }) => {
  // Rows are seeded per local day, so a run that straddles local midnight will
  // legitimately see a different page on the reload. Re-run it.
  const signature = () =>
    page.getByTestId("home-row").evaluateAll((rows) =>
      rows.map((r) => `${r.getAttribute("data-row-key")}:${[...r.querySelectorAll('[data-testid="game-card"]')].map((a) => a.getAttribute("href")).join(",")}`).join("|"),
    );
  await page.goto("/");
  const before = await signature();
  await page.reload();
  expect(await signature()).toBe(before);

  // And after a round trip through a game, which is the way this feature is
  // most likely to be got wrong.
  await page.getByTestId("home-row").first().getByTestId("game-card").first().click();
  await expect(page.getByTestId("game-title")).toBeVisible();
  await page.goBack();
  expect(await signature()).toBe(before);
});

test("the rows scroll sideways; the page never does", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByTestId("home-row").first()).toBeVisible();
  const page_ = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(page_.scrollWidth, "the page must not scroll horizontally").toBeLessThanOrEqual(page_.clientWidth);

  // A full row, not the six picks: those fit on a desktop and have nothing to scroll.
  const carousel = page.getByTestId("home-row").first().getByTestId("carousel");
  const scrolled = await carousel.evaluate((el) => {
    el.scrollLeft = 300;
    return el.scrollLeft;
  });
  expect(scrolled, "the row is its own scroll container").toBeGreaterThan(0);
  const after = await page.evaluate(() => window.scrollX);
  expect(after).toBe(0);
});
