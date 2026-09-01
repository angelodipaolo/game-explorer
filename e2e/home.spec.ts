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
  test.skip(!isMobile, "the icon is the phone presentation; from `md` up the field is inline");
  // `/playing`, not `/`: home's glyph is a shortcut to the hero now and has no
  // panel of its own to open (GAMEEXPLOR-0033).
  await page.goto("/playing");
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
  await page.getByTestId("filter-search-input").click();
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

  const noOverflow = async (where: string) => {
    const box = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
    expect(box.scrollWidth, `the header must not burst the row on ${where}`).toBeLessThanOrEqual(box.clientWidth);
  };
  await page.goto("/");
  await noOverflow("home");
  // The disclosed panel is the state that can burst it, and `/playing` is
  // where the panel still lives.
  await page.goto("/playing");
  if (isMobile) await page.getByTestId("header-search-toggle").click();
  await noOverflow("playing");
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

/**
 * One search per screen (GAMEEXPLOR-0033). Home used to render the
 * search-everything control twice — a 224px header field and a full-width hero
 * box, 100px apart, in different words, doing exactly the same thing. The
 * assertions below are the whole ticket: one *visible* search landmark on home
 * at every width, and the two controls never wearing the same shape at once.
 */

/** `getByRole` skips `display:none`, which is what makes this the honest count. */
test("home offers exactly one search, at every width", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one project drives the explicit widths");
  for (const width of [390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await expect(page.getByRole("search"), `${width}px`).toHaveCount(1);
    await expect(page.getByTestId("hero-search-input")).toBeVisible();
    // Below `md` the glyph stays: home is several screens tall and the hero is
    // not sticky, so a reader who has scrolled needs *something* in the sticky
    // bar. A 44px glyph beside the wordmark is not a second search bar. From
    // `md` up the hero is always the search you can see, so it goes.
    await expect(page.getByTestId("header-search-toggle")).toBeVisible({ visible: width < 768 });
  }
});

test("the two search controls are never the same shape at the same width", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one project drives the explicit widths");
  const headerField = page.getByTestId("header-search-input");
  const headerGlyph = page.getByTestId("header-search-toggle");
  const filterField = page.getByTestId("filter-search-input");
  const filterGlyph = page.getByTestId("filter-search-toggle");

  // Below `md`: the header is the glyph, the page's own filter is the prose.
  for (const width of [390, 640, 767]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/playing");
    await expect(headerGlyph, `${width}px`).toBeVisible();
    await expect(headerField, `${width}px`).toBeHidden();
    await expect(filterField, `${width}px`).toBeVisible();
    await expect(filterGlyph, `${width}px`).toBeHidden();
  }

  // From `md` up they swap. 768 is the tight case — four nav links, signed in.
  for (const width of [768, 1024, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/playing");
    await expect(headerField, `${width}px`).toBeVisible();
    await expect(headerGlyph, `${width}px`).toBeHidden();
    await expect(filterGlyph, `${width}px`).toBeVisible();
    await expect(filterField, `${width}px`).toBeHidden();

    // The header row it has to fit in: one line, 44px of it, nothing sticking out.
    const row = page.locator("header > div").nth(1);
    expect((await row.boundingBox())!.height, `the header row at ${width}px`).toBe(44);
    const doc = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
    expect(doc.scrollWidth, `the header must not burst the row at ${width}px`).toBeLessThanOrEqual(doc.clientWidth);
  }
});

test("the filter search narrows the page without ever leaving it", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "the collapsed presentation only exists from `md` up");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/playing");
  await expect(page.getByTestId("filter-search-toggle")).toBeVisible();

  /*
    The real proof that this is `history.replaceState` and not `router.replace`
    is **no request for the filtered URL**. `router.replace` re-renders the
    server page — an RSC fetch for `/playing?q=…` on every keystroke, re-sending
    the whole payload — which is exactly what `use-filters.ts` refuses to do and
    what a reader on a phone would feel. `history.length` cannot show that:
    `router.replace` leaves it unchanged too, so on its own it only rules out
    `push`. Both are asserted, the request count first.

    Requests for a bare `/playing` are not counted: Next prefetches the header's
    own nav link, and that is not this control's doing. A `q` in the URL is what
    only a filter change could have produced.
  */
  const filteredFetches: string[] = [];
  page.on("request", (r) => {
    const u = new URL(r.url());
    if (u.pathname === "/playing" && u.searchParams.has("q")) filteredFetches.push(`${r.method()} ${r.url()}`);
  });
  const before = await page.evaluate(() => history.length);
  await page.getByTestId("filter-search-toggle").click();
  await expect(page.getByTestId("filter-search-input")).toBeFocused();
  await page.getByTestId("filter-search-input").fill("contra");
  await expect(page).toHaveURL(/\/playing\?q=contra/);
  await expect(page.getByRole("heading", { name: /In progress/ })).toContainText(/·\s*\d+ of \d+/);
  expect(filteredFetches, "a filter change must not re-render the server page").toEqual([]);
  expect(await page.evaluate(() => history.length), "and it is not a `push` either").toBe(before);

  // Escape puts the field away and *keeps* the term — a native
  // `<input type="search">` would have emptied it, which is a filter
  // disappearing on a keystroke nobody asked to be destructive.
  await page.getByTestId("filter-search-input").press("Escape");
  const chip = page.getByTestId("filter-search-chip");
  await expect(chip).toBeVisible();
  await expect(chip).toContainText("contra");
  await expect(chip).toBeFocused();
  await expect(page).toHaveURL(/\/playing\?q=contra/);

  // The ✕ is the only thing that clears, and focus comes back to the glyph
  // that replaces the chip rather than falling to <body>.
  await page.getByTestId("filter-search-clear").click();
  await expect(page).toHaveURL(/\/playing$/);
  await expect(page.getByTestId("filter-search-toggle")).toBeFocused();
});

test("a filtered link never hides its own filter", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "the collapsed presentation only exists from `md` up");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/playing?q=contra");
  // The one hard rule of the control: arriving with a term in the URL must
  // never render as an empty-looking glyph.
  await expect(page.getByTestId("filter-search-chip")).toContainText("contra");
  await expect(page.getByTestId("filter-search-toggle")).toBeHidden();
  await expect(page.getByTestId("open-filters")).toContainText("· 1");
});

test("the shelf keeps its box, and calls it what it is", async ({ page }) => {
  await page.goto("/shelf");
  // One control, one dataset, one name: this is the box you land in from the
  // hero, and it is the same matcher over the same games.
  const box = page.getByPlaceholder("Search all games");
  await expect(box).toBeVisible();
  await expect(page.getByRole("search")).toHaveCount(1);

  // Enter is a no-op here — the term is already in the URL — and must not
  // submit the form, which would navigate and drop every other filter.
  await page.goto("/shelf?platform=nes");
  /*
    Wait for hydration, not for pixels. `result-count` is server-rendered and
    visible long before the shelf is listening, and a `fill` that lands in that
    window goes into an input React is about to re-render from its own state —
    the keystroke vanishes with no error anywhere, and the assertion below
    fails on a `q` that was typed and thrown away. `shelf:last` is written by
    `useFilters`' mount effect, so it appearing *is* the client having taken
    over this URL.
  */
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem("shelf:last"))).toContain("platform=nes");
  await box.fill("mario");
  await box.press("Enter");
  await expect(page).toHaveURL(/platform=nes/);
  await expect(page).toHaveURL(/q=mario/);
});

test("the Filters button stays put and stays clickable while the search is open", async ({ page }) => {
  /*
    The regression this exists to stop: the filter search's form was `flex-1`
    while open and `md:flex-none` while collapsed, and blur fires on
    *mousedown*. So reaching for `Filters` with the field open collapsed the row
    between the press and the release, `Filters` jumped 1122px at 1280, and the
    click landed on nothing. It worked the second time, which is why it read as
    flakiness rather than as a bug. `mouse.down()`/`mouse.up()` rather than
    `click()`, because `click()` re-resolves the element's box between the two
    and would paper straight over it.
  */
  for (const width of [768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/playing");
    const filters = page.getByTestId("open-filters");
    await expect(filters).toBeVisible();
    const parked = (await filters.boundingBox())!;

    // Open the field, however this width opens it.
    const glyph = page.getByTestId("filter-search-toggle");
    if (await glyph.isVisible()) await glyph.click();
    else await page.getByTestId("filter-search-input").click();
    await expect(page.getByTestId("filter-search-input")).toBeFocused();

    const moved = (await filters.boundingBox())!;
    expect(Math.abs(moved.x - parked.x), `Filters moved when the search opened at ${width}px`).toBeLessThanOrEqual(1);

    // Press where it is, release where it is, and the sheet must open.
    await page.mouse.move(moved.x + moved.width / 2, moved.y + moved.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    await expect(page.getByTestId("filter-sheet"), `one press of Filters at ${width}px`).toBeVisible();
    await page.keyboard.press("Escape");
  }
});

test("home's glyph is a shortcut to the hero, not a second box", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "one project drives the explicit widths");
  for (const width of [390, 640]) {
    await page.setViewportSize({ width, height: 700 });
    await page.goto("/");
    const glyph = page.getByTestId("header-search-toggle");
    await expect(glyph).toBeVisible();

    // Scroll the hero off the top — the state the glyph exists for. Home is
    // several screens tall and the hero is not sticky.
    await page.evaluate(() => window.scrollTo(0, 1200));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(600);

    await glyph.click();
    const hero = page.getByTestId("hero-search-input");
    // It moves you to the one box home has, and puts the caret in it.
    await expect(hero).toBeFocused();
    await expect.poll(() => page.evaluate(() => document.getElementById("home-search")!.getBoundingClientRect().top), { timeout: 3000 }).toBeGreaterThan(0);
    await expect.poll(() => page.evaluate(() => document.getElementById("home-search")!.getBoundingClientRect().bottom)).toBeLessThan(700);

    // And it never conjures a second one. Two visible fields both saying
    // "Search all games" is the complaint this whole ticket is about.
    await expect(page.getByPlaceholder("Search all games")).toHaveCount(1);
    await expect(page.getByRole("search")).toHaveCount(1);
    await expect(page.getByTestId("header-search")).toHaveCount(0);

    // And with the hero already on screen, where there is nowhere to scroll to
    // and the whole job is the caret.
    await page.goto("/");
    await expect(glyph).toBeVisible();
    await glyph.click();
    await expect(hero).toBeFocused();
  }
});
