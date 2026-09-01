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

/**
 * Search (GAMEEXPLOR-0027). Every collection search is a navigation to
 * `/shelf?q=…` — there is no index and no overlay to test, only that the
 * boxes land you on a filtered, linkable shelf.
 */

test("the home hero search lands on a filtered shelf", async ({ page }) => {
  await expectNoConsoleErrors(page, async () => {
    await page.goto("/");
    await page.getByTestId("hero-search-input").fill("mario");
    await page.getByTestId("hero-search-submit").click();

    await expect(page).toHaveURL(/\/shelf\?q=mario/);
    // Filtered, not the whole shelf, and the matches are the ones asked for.
    await expect(page.getByTestId("result-count")).toContainText(/^\d+ games?/);
    await expect(page.getByTestId("game-card").first()).toContainText(/mario/i);

    // An empty submit is a no-op: it must not dump you on the whole shelf.
    // `toHaveURL` alone would pass at t=0 whatever happens next, so give the
    // navigation that must not happen time to happen, and check the page we
    // were on is still the page we are on.
    await page.goBack();
    await expect(page.getByTestId("hero-search-input")).toHaveValue("");
    await page.getByTestId("hero-search-submit").click();
    await page.waitForTimeout(500);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByTestId("tonights-picks")).toBeVisible();
  });
});

test("the search survives characters a URL cares about", async ({ page }) => {
  await page.goto("/");
  await page.getByTestId("hero-search-input").fill("mario & luigi");
  await page.getByTestId("hero-search-submit").click();
  await expect(page).toHaveURL(/\/shelf\?q=/);
  // Read the term back out of the URL rather than matching an encoding: what
  // matters is that `&` arrived as part of the query and not as a separator.
  expect(new URL(page.url()).searchParams.get("q")).toBe("mario & luigi");
  await expect(page.getByTestId("game-card").first()).toContainText(/mario & luigi/i);
});

test("the phone search icon closes what it opened, and Escape hands focus back", async ({ page, isMobile }) => {
  test.skip(!isMobile, "the icon is the phone presentation; from `sm` up the field is inline");
  await page.goto("/");
  const toggle = page.getByTestId("header-search-toggle");
  const input = page.getByTestId("header-search-input");

  // Open, then close with the same icon. The blur the tap causes must not
  // re-open it — the bug this locks down was three taps and still open.
  await toggle.click();
  await expect(input).toBeFocused();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await toggle.click();
  await expect(input).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toBeFocused();
  await toggle.click();
  await expect(input).toBeVisible();

  // Escape closes it and gives focus back to the icon, not to <body>: the next
  // Tab has to carry on from here, not restart at the top of the document.
  await input.press("Escape");
  await expect(input).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toBeFocused();

  // And tapping the page closes it too.
  await toggle.click();
  await expect(input).toBeFocused();
  await page.getByTestId("hero-search-input").click();
  await expect(input).toBeHidden();
});

test("the header search opens the collection from anywhere", async ({ page, isMobile }) => {
  await page.goto("/playing");
  const input = page.getByTestId("header-search-input");
  if (isMobile) {
    // Phone: the icon only, until it is tapped.
    await expect(input).toBeHidden();
    await page.getByTestId("header-search-toggle").click();
    await expect(input).toBeFocused();
  } else {
    await expect(page.getByTestId("header-search-toggle")).toBeHidden();
    await expect(input).toBeVisible();
  }
  await input.fill("zelda");
  await input.press("Enter");
  await expect(page).toHaveURL(/\/shelf\?q=zelda/);
  await expect(page.getByTestId("game-card").first()).toContainText(/zelda/i);
});

test("the header search stays out of the shelf's way, and the row never overflows", async ({ page, isMobile }) => {
  await page.goto("/shelf");
  await expect(page.getByTestId("result-count")).toBeVisible();
  // The shelf's own toolbar is the better box for the shelf; two is noise.
  await expect(page.getByTestId("header-search")).toHaveCount(0);
  await expect(page.getByTestId("header-search-toggle")).toHaveCount(0);

  await page.goto("/");
  if (isMobile) await page.getByTestId("header-search-toggle").click();
  const box = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
  expect(box.scrollWidth, "the header must not burst the row").toBeLessThanOrEqual(box.clientWidth);
});

test("a page's own search box offers the whole collection when the answer is not there", async ({ page }) => {
  await page.goto("/playing?q=zzzqqq");
  const link = page.getByTestId("search-all-games");
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", "/shelf?q=zzzqqq");

  // And it is only there while there is something to search for.
  await page.goto("/playing");
  await expect(page.getByTestId("search-all-games")).toHaveCount(0);
});
