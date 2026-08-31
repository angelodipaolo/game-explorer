import { expect, test, type Page } from "@playwright/test";

/**
 * Reference material on a game page: bookmarks (guides, wikis, longplays) and
 * scanned manuals.
 *
 * Runs against the live dev database, so every fixture is named "E2E" and
 * namespaced by project — desktop and phone run in parallel against the same
 * game, and one worker's clean-up must not take the other's row. Everything
 * created here is removed at the end through the same API the page uses.
 */

const titleFor = (project: string) => `E2E ${project} — FAQ/Walkthrough`;
const urlFor = (project: string) => `https://example.test/e2e/${project}/guide`;
const manualFor = (project: string) => `E2E ${project} manual`;

async function openContra(page: Page) {
  await page.goto("/shelf?q=Contra&platform=nes");
  await page.getByTestId("game-card").first().click();
  await expect(page.getByTestId("game-title")).toHaveText("Contra");
  return new URL(page.url()).pathname.match(/^\/game\/(.+)$/)![1];
}

/** Remove any E2E bookmark left behind, matched on this project's title prefix. */
async function cleanUpBookmarks(page: Page, gameId: string, prefix: string) {
  await page.evaluate(
    async ([id, mine]) => {
      const rows: { id: string; title: string }[] = await (await fetch(`/api/games/${id}/bookmarks`)).json();
      for (const b of rows) if (b.title.startsWith(mine)) await fetch(`/api/bookmarks/${b.id}`, { method: "DELETE" });
    },
    [gameId, prefix],
  );
}

/**
 * Guides & links collapses at rest when there is nothing in it yet
 * (GAMEEXPLOR-0023 round 2, item E) — open it the way a person would before
 * touching anything inside. Idempotent, like `openCodes` in
 * `game-codes.spec.ts`.
 */
async function openGuides(page: Page) {
  const toggle = page.getByTestId("section-toggle-guides");
  if ((await toggle.getAttribute("aria-expanded")) !== "true") await toggle.click();
}

async function cleanUpManuals(page: Page, gameId: string, title: string) {
  await page.evaluate(
    async ([id, mine]) => {
      const rows: { id: string; title: string }[] = await (await fetch(`/api/games/${id}/manuals`)).json();
      for (const m of rows) if (m.title === mine) await fetch(`/api/manuals/${m.id}`, { method: "DELETE" });
    },
    [gameId, title],
  );
}

/** A 40×56 PNG made in the browser, so the page image route has something real to serve. */
async function makePng(page: Page, label: string) {
  return page.evaluate((text) => {
    const c = document.createElement("canvas");
    c.width = 40;
    c.height = 56;
    const g = c.getContext("2d")!;
    g.fillStyle = "#f2efe6";
    g.fillRect(0, 0, 40, 56);
    g.fillStyle = "#222";
    g.font = "10px sans-serif";
    g.fillText(text, 4, 30);
    return c.toDataURL("image/png").split(",")[1];
  }, label);
}

test("a bookmark can be added from the game page and groups under its kind", async ({ page }, testInfo) => {
  const TITLE = titleFor(testInfo.project.name);
  const URL_ = urlFor(testInfo.project.name);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("dialog", (d) => d.accept());

  const gameId = await openContra(page);
  await cleanUpBookmarks(page, gameId, TITLE);
  await page.reload();

  // Everything past this point can leave a row behind on the live database, so
  // the clean-up is a finally, not a last line.
  try {
    await openGuides(page);
    await page.getByTestId("add-bookmark").click();
    await page.getByTestId("bookmark-url").fill(URL_);
    await page.getByTestId("bookmark-title").fill(TITLE);
    await page.getByTestId("bookmark-why").fill("Stage by stage for the NES release");
    await page.getByTestId("save-bookmark").click();

    const row = page.getByTestId("bookmark-row").filter({ hasText: TITLE });
    await expect(row).toBeVisible();
    // The why-line is the point of the row, so it must be on the row.
    await expect(row).toContainText("Stage by stage for the NES release");
    // Grouped under its kind, and an outbound link that opens in a new tab.
    await expect(page.getByTestId("bookmarks")).toContainText("Guides & walkthroughs");
    const link = row.getByTestId("bookmark-link");
    await expect(link).toHaveAttribute("href", URL_);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("rel", /noreferrer/);
    // One-handed use: the row itself is the tap target.
    expect((await link.boundingBox())!.height).toBeGreaterThanOrEqual(44);

    // Edit it in place, then remove it.
    await page.getByTestId("edit-bookmarks").click();
    await row.getByRole("button", { name: `Edit ${TITLE}` }).click();
    await page.getByTestId("bookmark-why").fill("Revised: covers the two-player route too");
    await page.getByTestId("save-bookmark").click();
    const edited = page.getByTestId("bookmark-row").filter({ hasText: "Revised: covers the two-player route too" });
    await expect(edited).toBeVisible();

    await edited.getByRole("button", { name: /^Edit / }).click();
    await page.getByTestId("delete-bookmark").click();
    await expect(page.getByTestId("bookmark-row").filter({ hasText: TITLE })).toHaveCount(0);

    expect(errors, "console errors").toEqual([]);
  } finally {
    await cleanUpBookmarks(page, gameId, TITLE);
  }
});

test("a bookmark written through the batch API is an ordinary row on the page", async ({ page }, testInfo) => {
  const TITLE = `${titleFor(testInfo.project.name)} from a batch`;
  page.on("dialog", (d) => d.accept());
  const gameId = await openContra(page);
  await cleanUpBookmarks(page, gameId, TITLE);

  const result = await page.evaluate(
    async ([id, title, url]) => {
      const res = await fetch("/api/bookmarks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ bookmarks: [{ ownedGameId: id, kind: "longplay", url, title, why: "One-life run, no commentary" }] }),
      });
      return res.json();
    },
    [gameId, TITLE, `${urlFor(testInfo.project.name)}/batch`],
  );
  expect(result.written).toHaveLength(1);
  expect(result.skipped).toHaveLength(0);

  try {
    await page.reload();
    const row = page.getByTestId("bookmark-row").filter({ hasText: TITLE });
    await expect(row).toBeVisible();
    await expect(page.getByTestId("bookmarks")).toContainText("Longplays");
    // No provenance badge: it is editable and removable exactly like a typed-in one.
    await page.getByTestId("edit-bookmarks").click();
    await row.getByRole("button", { name: /^Edit / }).click();
    await page.getByTestId("delete-bookmark").click();
    await expect(page.getByTestId("bookmark-row").filter({ hasText: TITLE })).toHaveCount(0);
  } finally {
    await cleanUpBookmarks(page, gameId, TITLE);
  }
});

test("the gaps endpoint answers in the shape a research skill drives", async ({ request }) => {
  const res = await request.get("/api/bookmarks/gaps?limit=1");
  expect(res.ok()).toBe(true);
  const { total, gaps } = await res.json();
  expect(typeof total).toBe("number");
  // Count-agnostic: the shelf gains bookmarks over time, so only the shape is asserted.
  if (gaps.length) expect(Object.keys(gaps[0])).toEqual(expect.arrayContaining(["ownedGameId", "title", "name", "platform", "have"]));
});

test("a scanned manual shows on the game page and pages through in the viewer", async ({ page }, testInfo) => {
  const MANUAL = manualFor(testInfo.project.name);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  const gameId = await openContra(page);
  await cleanUpManuals(page, gameId, MANUAL);

  const one = await makePng(page, "1");
  const two = await makePng(page, "2");
  const manualId = await page.evaluate(
    async ([id, title, a, b]) => {
      const manual = await (await fetch(`/api/games/${id}/manuals`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title }) })).json();
      // Two steps per page, exactly as a scanning pass does it: POST the row,
      // then PUT the bytes.
      for (const [i, png] of [a, b].entries()) {
        const page_ = await (await fetch(`/api/manuals/${manual.id}/pages`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ label: `Page ${i + 1}` }) })).json();
        const up = await fetch(`/api/manual-pages/${page_.id}/image`, { method: "PUT", body: Uint8Array.from(atob(png), (c) => c.charCodeAt(0)) });
        if (!up.ok) throw new Error(`upload ${up.status}`);
      }
      return manual.id as string;
    },
    [gameId, MANUAL, one, two],
  );

  try {
    await page.reload();
    const card = page.getByTestId("manual-card").filter({ hasText: MANUAL });
    await expect(card).toBeVisible();
    await expect(card).toContainText("2 pages");
    await card.click();

    await expect(page).toHaveURL(new RegExp(`/game/${gameId}/manual\\?m=${manualId}`));
    await expect(page.getByTestId("manual-viewer")).toBeVisible();
    await expect(page.getByTestId("manual-page-count")).toHaveText("Page 1 of 2");
    await expect(page.getByTestId("manual-page-image")).toBeVisible();

    // Paging forward and back, with real tap targets.
    const next = page.getByTestId("manual-next");
    const prev = page.getByTestId("manual-prev");
    for (const b of [next, prev]) expect((await b.boundingBox())!.height, "one-handed tap target").toBeGreaterThanOrEqual(44);
    await expect(prev).toBeDisabled();
    await next.click();
    await expect(page.getByTestId("manual-page-count")).toHaveText("Page 2 of 2");
    await expect(next).toBeDisabled();
    await prev.click();
    await expect(page.getByTestId("manual-page-count")).toHaveText("Page 1 of 2");

    // No horizontal overflow at any width this runs at.
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, "horizontal overflow").toBeLessThanOrEqual(1);

    await page.getByTestId("manual-back").click();
    await expect(page.getByTestId("game-title")).toHaveText("Contra");
    expect(errors, "console errors").toEqual([]);
  } finally {
    await page.evaluate((id) => fetch(`/api/manuals/${id}`, { method: "DELETE" }), manualId);
  }
});
