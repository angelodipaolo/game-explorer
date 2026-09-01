import { expect, test, type Page } from "@playwright/test";
import { AA, TARGET, expectHitArea, expectModal, expectNoHorizontalOverflow, expectRenderedFaint, expectTapTarget, expectTokenContrast, focusedTestId } from "./helpers/adaptive";

/**
 * Adaptive hardening (GAMEEXPLOR-0023): the assertions that hold the phone and
 * tablet experience in place. Runs on all four projects — desktop, phone
 * (WebKit, the closest proxy for the owner's Safari), tablet portrait and
 * tablet landscape — and the two tablet projects run *only* this file, because
 * doubling the whole suite to re-check the same flows at 810px buys nothing.
 *
 * The rules, and where each is enforced:
 *  - no document-level horizontal overflow on any reviewed route,
 *  - every overlay is a real modal: focus in, trapped, restored, page inert,
 *  - 44×44 CSS pixels of target, by ink where a control can grow and by hit
 *    area where it cannot (map markers, compact edit pills),
 *  - `--faint` and its neighbours clear AA on every ground.
 *
 * Fixtures (a journal photo, a manual) are created through the same API a
 * skill uses, on a game chosen by project index so four projects never touch
 * the same row, and removed in a `finally`.
 */

const PROJECTS = ["desktop", "phone", "tablet-portrait", "tablet-landscape"];

/** A different game per project, so concurrent projects cannot collide over one copy. */
const gameIndex = (project: string) => Math.max(0, PROJECTS.indexOf(project));

async function openNthGame(page: Page, n: number): Promise<string> {
  await page.goto("/shelf?sort=title");
  const cards = page.getByTestId("game-card");
  await expect(cards.first()).toBeVisible();
  await cards.nth(n).click();
  await expect(page.getByTestId("game-title")).toBeVisible();
  return new URL(page.url()).pathname.split("/").pop()!;
}

/** A 64×64 PNG made in the browser, so the image routes have real bytes to serve. */
async function makePng(page: Page): Promise<string> {
  return page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 64;
    const g = c.getContext("2d")!;
    g.fillStyle = "#2c8a2c";
    g.fillRect(0, 0, 64, 64);
    return c.toDataURL("image/png").split(",")[1];
  });
}

/** The first game in the collection that actually has a map, or null. */
async function findGameWithMap(page: Page): Promise<{ id: string; slug: string } | null> {
  for (const q of ["Zelda II", "Legacy of the Wizard", "Final Fantasy II"]) {
    await page.goto(`/shelf?q=${encodeURIComponent(q)}`);
    const card = page.getByTestId("game-card").first();
    if (!(await card.isVisible().catch(() => false))) continue;
    await card.click();
    await expect(page.getByTestId("game-title")).toBeVisible();
    const id = new URL(page.url()).pathname.split("/").pop()!;
    const maps: { slug: string }[] = await page.evaluate((g) => fetch(`/api/games/${g}/maps`).then((r) => r.json()), id);
    if (maps.length) return { id, slug: maps[0].slug };
  }
  return null;
}

test.describe("adaptive", () => {
  test("every reviewed route lays out without horizontal overflow", async ({ page }) => {
    const gameId = await openNthGame(page, 0);
    const routes: [string, string][] = [
      ["home", "/"],
      ["shelf", "/shelf"],
      ["shelf, filtered", "/shelf?platform=nes&players=2&mode=coop"],
      ["playing", "/playing"],
      ["flip", "/flip?platform=nes"],
      ["series", "/series"],
      ["game detail", `/game/${gameId}`],
    ];
    for (const [name, url] of routes) {
      await page.goto(url);
      await page.waitForLoadState("domcontentloaded");
      await expectNoHorizontalOverflow(page, name);
    }

    // A series page too, if the collection has one.
    await page.goto("/series");
    const series = page.getByTestId("series-card").first();
    if (await series.isVisible().catch(() => false)) {
      await series.click();
      await expectNoHorizontalOverflow(page, "a series");
    }
  });

  test("the reviewed routes hold at 375×667, 768×1024 and 1024×768", async ({ page }, testInfo) => {
    // The three sizes the ticket names, driven explicitly rather than left to
    // whichever device a project happens to emulate. One project runs it: the
    // page is the same page at a given width in every engine, and running it
    // four times only costs minutes.
    test.skip(testInfo.project.name !== "desktop", "one project drives the explicit widths");
    const gameId = await openNthGame(page, 0);
    const sizes = [
      { name: "phone", width: 375, height: 667 },
      { name: "tablet portrait", width: 768, height: 1024 },
      { name: "tablet landscape", width: 1024, height: 768 },
    ];
    for (const size of sizes) {
      await page.setViewportSize({ width: size.width, height: size.height });
      for (const [name, url] of [
        ["home", "/"],
        ["shelf", "/shelf"],
        ["playing", "/playing"],
        ["flip", "/flip"],
        ["series", "/series"],
        ["game detail", `/game/${gameId}`],
      ] as [string, string][]) {
        await page.goto(url);
        await expectNoHorizontalOverflow(page, `${name} at ${size.name}`);
      }

      // The controls that must survive every width.
      await page.goto("/shelf");
      await expect(page.getByTestId("open-platforms")).toBeVisible();
      await expect(page.getByTestId("open-filters")).toBeVisible();
      await expect(page.getByTestId("preset").first()).toBeVisible();
      await expect(page.getByTestId(size.width < 640 ? "flip-link-phone" : "flip-link")).toBeVisible();
    }
  });

  test("the main menu and the filter sheet are real modals", async ({ page }) => {
    await page.goto("/shelf");
    await expect(page.getByTestId("result-count")).toContainText(/games/);

    await expectModal(page, {
      name: "the main menu",
      overlay: "platform-sidebar",
      trigger: "open-platforms",
      reference: page.getByTestId("result-count"),
      open: () => page.getByTestId("open-platforms").click(),
    });

    await expectModal(page, {
      name: "the filter sheet",
      overlay: "filter-sheet",
      trigger: "open-filters",
      reference: page.getByTestId("result-count"),
      open: () => page.getByTestId("open-filters").click(),
    });

    // And the close button gets you out the same way the keyboard does.
    await page.getByTestId("open-filters").click();
    await expect(page.getByTestId("filter-sheet")).toBeVisible();
    await page.getByTestId("close-filters").click();
    await expect(page.getByTestId("filter-sheet")).toBeHidden();
    expect(await focusedTestId(page), "closing by button restores focus too").toBe("open-filters");
  });

  test("the screenshot viewer is a real modal", async ({ page }, testInfo) => {
    await openNthGame(page, gameIndex(testInfo.project.name));
    const thumb = page.getByTestId("screenshot-thumb").first();
    test.skip(!(await thumb.isVisible().catch(() => false)), "this copy has no screenshots");
    await expectModal(page, {
      name: "the screenshot viewer",
      overlay: "screenshot-viewer",
      trigger: "screenshot-thumb",
      open: () => thumb.click(),
      tabs: 6,
    });
  });

  test("the journal photo viewer is a real modal", async ({ page }, testInfo) => {
    const project = testInfo.project.name;
    const gameId = await openNthGame(page, gameIndex(project));
    const title = `E2E ${project} photo`;
    const png = await makePng(page);
    const entryId: string = await page.evaluate(
      async ([id, name, b64]) => {
        const today = new Date();
        const when = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
        const entry = await (
          await fetch(`/api/games/${id}/journal`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "photo", title: name, body: null, occurredAt: when, sessionId: null }) })
        ).json();
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        const put = await fetch(`/api/journal/${entry.id}/image`, { method: "PUT", headers: { "content-type": "image/png" }, body: bytes });
        if (!put.ok) throw new Error(`photo upload ${put.status}`);
        return entry.id as string;
      },
      [gameId, title, png],
    );

    try {
      await page.reload();
      const section = page.getByTestId("section-toggle-journal");
      if ((await section.getAttribute("aria-expanded")) !== "true") await section.click();
      const thumb = page.getByRole("button", { name: `Open ${title} full screen` });
      await expect(thumb).toBeVisible();
      await expectModal(page, {
        name: "the journal photo viewer",
        overlay: "journal-photo-viewer",
        trigger: "journal-photo-thumb",
        open: () => thumb.click(),
        tabs: 4,
      });
    } finally {
      await page.evaluate((id) => fetch(`/api/journal/${id}`, { method: "DELETE" }), entryId);
    }
  });

  test("primary controls meet the 44px standard", async ({ page }) => {
    await page.goto("/shelf");
    await expect(page.getByTestId("result-count")).toContainText(/games/);
    await expectTapTarget(page.getByTestId("open-platforms"), "the hamburger");
    await expectTapTarget(page.getByTestId("open-filters"), "the Filters button");
    await expectTapTarget(page.getByTestId("preset").first(), "a filter preset");
    await expectTapTarget(page.getByTestId("genre-chip").first(), "a genre chip");

    // The header's own nav row is the tablet's navigation, and a tablet is a
    // touch device: it is `hidden` below `sm` and 44px tall from there up.
    const shelfLink = page.getByTestId("nav-playing");
    if (await shelfLink.isVisible()) await expectTapTarget(shelfLink, "a header nav link");

    // Inside the sheet: the segmented and chip controls a thumb aims at.
    await page.getByTestId("open-filters").click();
    await expect(page.getByTestId("filter-sheet")).toBeVisible();
    await expectTapTarget(page.getByRole("button", { name: "Just me", exact: true }), "a players segment");
    await page.keyboard.press("Escape");

    // Flip: the three big ones, and the drawer that reaches every console.
    await page.goto("/flip");
    await expectTapTarget(page.getByTestId("flip-prev"), "flip previous");
    await expectTapTarget(page.getByTestId("flip-next"), "flip next");
    await expectTapTarget(page.getByTestId("flip-surprise"), "flip surprise");

    await page.goto("/playing");
    /*
      The header's own search field, which is where the 36px/14px defect lived
      until GAMEEXPLOR-0033 — on both iPads, the two projects that exist
      precisely to catch this, and which never measured it. 16px is the second
      half: below it, iPadOS zooms the whole page on focus.
    */
    await expect(page.getByTestId("open-filters")).toBeVisible();
    const headerSearch = page.getByTestId("header-search-input");
    if (await headerSearch.isVisible()) {
      await expectTapTarget(headerSearch, "the header search field");
      expect(await headerSearch.evaluate((el) => parseFloat(getComputedStyle(el).fontSize)), "the header search's text").toBeGreaterThanOrEqual(16);
    }

    /*
      And the page's own filter search, in whichever shape this width gives it:
      a glyph from `md` up, the field itself below. `:visible` rather than a
      width branch, because which one is on screen is the thing being asserted
      and either answer is a control a thumb has to be able to hit.
    */
    await expectTapTarget(page.locator('[data-testid="filter-search-toggle"]:visible, [data-testid="filter-search-input"]:visible').first(), "the filter search");
    await page.goto("/playing?q=contra");
    await expect(page.getByTestId("search-all-games")).toBeVisible();
    // Below `md` the field never collapses, so there is no chip to measure.
    const chip = page.getByTestId("filter-search-chip");
    if (await chip.isVisible()) {
      await expectTapTarget(chip, "the filter search's chip");
      await expectTapTarget(page.getByTestId("filter-search-clear"), "the filter search's clear");
    }
    await expectNoHorizontalOverflow(page, "playing, filtered");
    await page.goto("/playing");
    await expect(page.getByTestId("open-filters")).toBeVisible();

    const queueUp = page.getByTestId("queue-up").first();
    if (await queueUp.isVisible().catch(() => false)) {
      await expectTapTarget(queueUp, "the queue's move-up");
      await expectTapTarget(page.getByTestId("queue-play-now").first(), "the queue's Play now");
      await expectTapTarget(page.getByTestId("queue-remove-row").first(), "the queue's remove");
    }
  });

  test("compact edit toggles keep a 44px hit area without growing their ink", async ({ page }, testInfo) => {
    const project = testInfo.project.name;
    const gameId = await openNthGame(page, gameIndex(project));
    /*
      The toggles the ticket actually named are the "Edit" pills a section
      header only grows once it has something in it — an empty game page shows
      the "+ code" twins instead, and an earlier version of this test measured
      those four and called it done. So the fixtures come first, through the
      same API a skill uses: a code, a bookmark, a note, a finished run and an
      open one, all named for this project and all removed in the `finally`.
    */
    const label = `E2E ${project}`;
    const fixture = await page.evaluate(
      async ([id, name]) => {
        const day = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        const post = async (url: string, body: unknown) => {
          const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
          if (!r.ok) throw new Error(`${url} → ${r.status} ${await r.text()}`);
          return r.json();
        };
        const today = new Date();
        const lastWeek = new Date(today.getTime() - 7 * 86_400_000);
        const code = await post(`/api/games/${id}/codes`, { kind: "password", effect: `${name} — stage 2`, code: "ABCD EFGH" });
        const bookmark = await post(`/api/games/${id}/bookmarks`, { kind: "guide", url: `https://example.test/${encodeURIComponent(name)}/guide`, title: `${name} guide`, why: "Stage by stage" });
        const entry = await post(`/api/games/${id}/journal`, { kind: "note", title: `${name} note`, body: "Got as far as the third stage.", occurredAt: day(today), sessionId: null });
        const past = await post(`/api/games/${id}/sessions`, { startedAt: day(lastWeek), endedAt: day(lastWeek), outcome: "completed" });
        // This copy may genuinely be in play already; only start (and only
        // clean up) a run if it is not.
        const runs: { id: string; endedAt: string | null }[] = await (await fetch(`/api/games/${id}/sessions`)).json();
        const already = runs.find((r) => !r.endedAt) ?? null;
        const open = already ? null : await post(`/api/games/${id}/sessions`, {});
        return { gameId: id, code: code.id as string, bookmark: bookmark.id as string, entry: entry.id as string, past: past.id as string, open: (open?.id ?? null) as string | null };
      },
      [gameId, label],
    );

    try {
      await page.reload();
      /** A section only shows its "Edit" pill while it is open. */
      const openSection = async (id: string) => {
        const toggle = page.getByTestId(`section-toggle-${id}`);
        await toggle.scrollIntoViewIfNeeded();
        if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
      };

      // The deliberate trade, asserted on each named control: the ink stays
      // under 44 (the section header stays compact) and the *hit area* is the
      // full square. Both halves, so nobody can satisfy one by abandoning the
      // other.
      const compact = async (testId: string) => {
        const pill = page.getByTestId(testId);
        await expect(pill, `${testId}: not on the page`).toBeVisible();
        const box = (await pill.boundingBox())!;
        expect(box.height, `${testId} should have stayed visually compact`).toBeLessThan(TARGET);
        await expectHitArea(pill, testId);
      };

      for (const [section, testId] of [
        ["codes", "edit-codes"],
        ["guides", "edit-bookmarks"],
        ["play", "edit-runs"],
        ["journal", "edit-journal"],
      ] as [string, string][]) {
        await openSection(section);
        await compact(testId);
      }

      // The fifth: the composer's "file under this run" pill, which only
      // exists while a run is open and the chip has been cleared.
      await page.getByTestId("journal-add-note").click();
      await expect(page.getByTestId("journal-composer")).toBeVisible();
      await page.getByTestId("journal-clear-run").click();
      await compact("journal-set-run");

      // And every other `.tap-44` on the page holds the same contract — the
      // empty-state twins on whichever sections this copy has nothing in.
      const pills = page.locator(".tap-44:visible");
      const count = await pills.count();
      expect(count, "the game page shows at least one compact edit toggle").toBeGreaterThan(0);
      for (let i = 0; i < count; i++) {
        const pill = pills.nth(i);
        const label = (await pill.getAttribute("data-testid")) ?? (await pill.textContent())?.trim() ?? `pill ${i}`;
        const box = (await pill.boundingBox())!;
        expect(box.height, `"${label}" should have stayed visually compact`).toBeLessThan(TARGET);
        await expectHitArea(pill, `"${label}"`);
      }

      // The one compact toggle that grew for real instead: it ends a wrapped
      // row of tag chips and sits above the sticky section nav, so it has no
      // square to borrow.
      const tags = page.getByTestId("edit-tags");
      if (await tags.isVisible().catch(() => false)) await expectTapTarget(tags, "the tag editor's toggle");
    } finally {
      await page.evaluate(async (f) => {
        const del = (url: string) => fetch(url, { method: "DELETE" });
        await del(`/api/games/${f.gameId}/codes/${f.code}`);
        await del(`/api/bookmarks/${f.bookmark}`);
        await del(`/api/journal/${f.entry}`);
        await del(`/api/sessions/${f.past}`);
        if (f.open) await del(`/api/sessions/${f.open}`);
      }, fixture);
    }
  });

  test("the map viewer's controls and markers are 44px", async ({ page }) => {
    const found = await findGameWithMap(page);
    test.skip(!found, "no map in this collection");
    await page.goto(`/game/${found!.id}/map?m=${found!.slug}`);
    await expect(page.getByTestId("map-viewer")).toBeVisible();
    await expectNoHorizontalOverflow(page, "the map viewer");

    for (const label of ["Zoom in", "Zoom out", "Fit map"]) {
      await expectTapTarget(page.getByRole("button", { name: label }), `the ${label} control`);
    }
    await expectTapTarget(page.getByTestId("map-back"), "the map's back link");

    const tab = page.getByTestId("map-tab").first();
    if (await tab.isVisible().catch(() => false)) await expectTapTarget(tab, "a map switcher tab");

    const handle = page.getByTestId("map-sheet-handle");
    if (await handle.isVisible().catch(() => false)) await expectTapTarget(handle, "the location sheet's handle");

    // A marker sits at an image pixel and must stay visually precise, so its
    // *button* is 44×44 and transparent and the coloured dot inside it is 28.
    // The box measured here is the hit area.
    const marker = page.getByTestId("map-marker").first();
    await expect(marker).toBeVisible();
    const box = (await marker.boundingBox())!;
    expect(box.width, "a marker's hit area").toBeGreaterThanOrEqual(TARGET - 0.5);
    expect(box.height, "a marker's hit area").toBeGreaterThanOrEqual(TARGET - 0.5);
    const dot = (await marker.locator("span").first().boundingBox())!;
    expect(dot.width, "the marker's ink stayed small").toBeLessThan(TARGET);

    await expectTapTarget(page.getByTestId("map-location").first(), "a location row");
  });

  test("the manual viewer pages and lays out", async ({ page }, testInfo) => {
    const project = testInfo.project.name;
    const gameId = await openNthGame(page, gameIndex(project));
    const png = await makePng(page);
    const manualId: string = await page.evaluate(
      async ([id, name, b64]) => {
        const manual = await (await fetch(`/api/games/${id}/manuals`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: `E2E ${name}` }) })).json();
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        for (const label of ["Cover", "Controls"]) {
          const p = await (await fetch(`/api/manuals/${manual.id}/pages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ label }) })).json();
          const put = await fetch(`/api/manual-pages/${p.id}/image`, { method: "PUT", headers: { "content-type": "image/png" }, body: bytes });
          if (!put.ok) throw new Error(`page upload ${put.status}`);
        }
        return manual.id as string;
      },
      [gameId, project, png],
    );

    try {
      await page.goto(`/game/${gameId}/manual?m=${manualId}`);
      await expect(page.getByTestId("manual-viewer")).toBeVisible();
      await expectNoHorizontalOverflow(page, "the manual viewer");
      await expect(page.getByTestId("manual-page-count")).toHaveText("Page 1 of 2");
      await expectTapTarget(page.getByTestId("manual-back"), "the manual's back link");
      await expectTapTarget(page.getByTestId("manual-prev"), "the manual's previous page");
      await expectTapTarget(page.getByTestId("manual-next"), "the manual's next page");
      await page.getByTestId("manual-next").click();
      await expect(page.getByTestId("manual-page-count")).toHaveText("Page 2 of 2");
    } finally {
      await page.evaluate((id) => fetch(`/api/manuals/${id}`, { method: "DELETE" }), manualId);
    }
  });

  test("faint text clears AA on every ground it is printed on", async ({ page }, testInfo) => {
    await openNthGame(page, gameIndex(testInfo.project.name));
    await expectTokenContrast(page, AA);
    // And it is not merely declared: what a real `.text-faint` element renders
    // as, against the background actually painted behind it.
    await expectRenderedFaint(page, page.locator(".text-faint:visible").first(), "faint text on the game page");
    await page.goto("/shelf");
    await expectTokenContrast(page, AA);

    /*
      The two places a token that measures AA still rendered below it, because
      an `opacity-*` above the text is not folded into `getComputedStyle().color`
      and so nothing here was looking: the preset chips' hints (4.30:1 at rest,
      2.27:1 on the pressed chip's red) and the shelf's "maybe" treatment
      (3.63:1). `expectRenderedFaint` now multiplies out every opacity between
      the text and its ground, so both are measured the way they are painted.
    */
    await page.goto("/shelf?length=quick&view=list");
    const presets = page.getByTestId("preset");
    const count = await presets.count();
    expect(count, "the shelf shows preset chips").toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const chip = presets.nth(i);
      const pressed = (await chip.getAttribute("aria-pressed")) === "true";
      await expectRenderedFaint(page, chip.locator("span").first(), `a preset chip's hint (${pressed ? "pressed" : "at rest"})`);
    }
    // "Something quick" is a filter with a large unknown tail, so this page
    // always has maybe rows to measure. The "?" is the one that carries the
    // meaning, and it is the one that used to fade with the row.
    const maybeMark = page.locator('[data-testid="game-row"] .text-faint', { hasText: "?" }).first();
    await expect(maybeMark, "the quick filter leaves a maybe tail to measure").toBeVisible();
    await expectRenderedFaint(page, maybeMark, "the shelf's maybe treatment");
    // The dimming itself is still there — it just rides on the art now.
    expect(await page.locator('[data-testid="game-row"] .opacity-70').count(), "a maybe row still dims its cover").toBeGreaterThan(0);
  });
});
