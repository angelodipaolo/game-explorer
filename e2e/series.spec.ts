import { expect, test, type Page } from "@playwright/test";

/**
 * Series: the index, a series page defaulting to what you own, the ?missing
 * toggle, and the link back out to a game.
 *
 * Runs against the live dev database, so the series is created through the
 * same API the UI uses, namespaced by project (desktop and phone run in
 * parallel), and deleted at the end. Nothing here asserts a collection size —
 * it builds its own two-entry series out of a game the shelf actually has.
 */

const nameFor = (project: string) => `E2E ${project} series`;
const slugFor = (project: string) => `e2e-${project}-series`;
const MISSING = "E2E entry nobody owns";

/** A game on the shelf that is linked to IGDB, plus its copy id. */
async function anOwnedGame(page: Page): Promise<{ ownedId: string; igdbId: number; name: string }> {
  await page.goto("/shelf");
  const cards = page.getByTestId("game-card");
  await expect(cards.first()).toBeVisible();
  for (let i = 0; i < 3; i++) {
    await cards.nth(i).click();
    await expect(page.getByTestId("game-title")).toBeVisible();
    const ownedId = new URL(page.url()).pathname.match(/^\/game\/(.+)$/)![1];
    // The IGDB match line moved into "This copy" (GAMEEXPLOR-0023), collapsed
    // by default — open it before reading its text.
    await page.getByTestId("section-toggle-copy").click();
    const igdb = (await page.getByTestId("lookup-links").innerText()).match(/IGDB #(\d+)/);
    const name = (await page.getByTestId("game-title").innerText()).trim();
    if (igdb) return { ownedId, igdbId: Number(igdb[1]), name };
    await page.goBack();
  }
  throw new Error("no catalog-linked game in the first three cards");
}

/**
 * An interrupted run leaves its series behind, and the next one would 409 on
 * the slug forever — the API deliberately never renames a slug that was asked
 * for by name. So the spec cleans up first, not only at the end.
 */
async function deleteBySlug(page: Page, slug: string) {
  await page.evaluate(async (wanted) => {
    const res = await fetch("/api/series");
    if (!res.ok) return;
    const cards = (await res.json()) as { id: string; slug: string }[];
    for (const c of cards.filter((x) => x.slug === wanted)) await fetch(`/api/series/${c.id}`, { method: "DELETE" });
  }, slug);
}

async function createSeries(page: Page, project: string, igdbId: number) {
  return page.evaluate(
    async ([name, slug, id, missing]) => {
      const res = await fetch("/api/series", {
        method: "POST",
        headers: { "content-type": "application/json" },
        // One entry you own and one free-text entry nobody could own, so the
        // "you own 1 of 2" line and the dimmed row are both real.
        body: JSON.stringify({ name, slug, entries: [{ igdbId: id }, { title: missing }] }),
      });
      if (!res.ok) throw new Error(`create failed: ${res.status}`);
      return (await res.json()) as { id: string; owned: number; total: number };
    },
    [nameFor(project), slugFor(project), igdbId, MISSING] as const,
  );
}

async function cleanUp(page: Page, seriesId: string) {
  await page.evaluate(async (id) => {
    await fetch(`/api/series/${id}`, { method: "DELETE" });
  }, seriesId);
}

test("index → series → the game page, with the missing toggle in the URL", async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  const game = await anOwnedGame(page);
  await deleteBySlug(page, slugFor(project));
  const created = await createSeries(page, project, game.igdbId);

  try {
    expect(created.total).toBe(2);
    expect(created.owned).toBe(1);

    // The index card carries the owned count.
    await page.goto("/series");
    const card = page.getByTestId("series-card").filter({ hasText: nameFor(project) });
    await expect(card).toBeVisible();
    await expect(card.getByTestId("series-count")).toHaveText("1 of 2 owned");

    // The series page opens on what you own only.
    await card.click();
    await expect(page.getByTestId("series-title")).toHaveText(nameFor(project));
    await expect(page.getByTestId("series-entry-owned")).toHaveCount(1);
    await expect(page.getByTestId("series-entry-missing")).toHaveCount(0);
    await expect(page.getByText(MISSING)).toHaveCount(0);

    // Asking for what is missing puts it in the URL, so the view is a link.
    await page.getByTestId("missing-toggle").click();
    await expect(page).toHaveURL(new RegExp(`/series/${slugFor(project)}\\?missing=1$`));
    await expect(page.getByTestId("series-entry-missing")).toHaveCount(1);
    // Twice on the row: the cover falls back to a typographic tile carrying the title.
    await expect(page.getByText(MISSING).first()).toBeVisible();
    await expect(page.getByText("not owned")).toBeVisible();

    // Straight back out of the series into the copy on the shelf.
    await page.getByTestId("series-entry-owned").first().click();
    await expect(page).toHaveURL(new RegExp(`/game/${game.ownedId}$`));
    await expect(page.getByTestId("game-title")).toHaveText(game.name);
    await expect(page.getByTestId("game-series").getByRole("link", { name: `Part of ${nameFor(project)}` })).toBeVisible();

    // …and back into the series from the game page.
    await page.getByTestId("game-series").getByRole("link", { name: `Part of ${nameFor(project)}` }).click();
    await expect(page.getByTestId("series-title")).toHaveText(nameFor(project));
  } finally {
    await cleanUp(page, created.id);
  }

  await page.goto("/series");
  await expect(page.getByTestId("series-card").filter({ hasText: nameFor(project) })).toHaveCount(0);
});

/**
 * The editing page (GAMEEXPLOR-0020): rename, reorder, edit an entry, remove
 * one, then delete the series.
 *
 * Same self-cleaning shape as the test above — the series is created through
 * the API, namespaced by project, and the `finally` deletes it whichever
 * assertion went red. The rename means the URL moves mid-test, which is
 * exactly the behaviour being checked, so the cleanup goes by id.
 *
 * The seed check is deliberately not driven here: it calls IGDB live, and a
 * spec that fails when a rate limit or the network does is worse than no spec.
 * `checkSeed` has unit coverage in src/lib/series/service.test.ts.
 */
test("editing a series: rename, reorder, edit an entry, remove one, delete", async ({ page }, testInfo) => {
  const project = testInfo.project.name;
  const game = await anOwnedGame(page);
  const renamedSlug = `${slugFor(project)}-renamed`;
  await deleteBySlug(page, slugFor(project));
  await deleteBySlug(page, renamedSlug);
  const created = await createSeries(page, project, game.igdbId);

  try {
    // In from the series page, which is where the control lives for the owner.
    await page.goto(`/series/${slugFor(project)}`);
    await page.getByTestId("edit-series").click();
    await expect(page).toHaveURL(new RegExp(`/series/${slugFor(project)}/edit$`));

    // Two entries, in the order they were created: the owned one, then the
    // free-text one nobody owns.
    const rows = page.getByTestId("entry-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(1).getByTestId("entry-name")).toHaveText(MISSING);

    // Details: a blurb and a new slug, which moves the page.
    await page.getByTestId("details-blurb").fill("Edited by the e2e suite");
    await page.getByTestId("details-slug").fill(renamedSlug);
    await page.getByTestId("save-details").click();
    await expect(page).toHaveURL(new RegExp(`/series/${renamedSlug}/edit$`));
    await expect(page.getByTestId("details-blurb")).toHaveValue("Edited by the e2e suite");

    // Reorder: one ▲ sends the whole permutation and the two swap.
    await rows.nth(1).getByTestId("entry-up").click();
    await expect(page.getByTestId("entry-row").first().getByTestId("entry-name")).toHaveText(MISSING);

    // The inline editor, on the free-text row: a section and a note.
    await page.getByTestId("entry-row").first().getByTestId("entry-edit").click();
    await expect(page.getByTestId("entry-form")).toBeVisible();
    await page.getByTestId("entry-section").fill("Spin-offs");
    await page.getByTestId("entry-note").fill("Nobody owns this one");
    await page.getByTestId("entry-save").click();
    await expect(page.getByTestId("entry-form")).toHaveCount(0);
    await expect(page.getByTestId("entry-row").first()).toContainText("Spin-offs");
    await expect(page.getByTestId("entry-row").first()).toContainText("Nobody owns this one");

    // An entry typed in by hand lands at the end.
    await page.getByTestId("new-entry-title").fill("E2E typed by hand");
    await page.getByTestId("add-entry").click();
    await expect(page.getByTestId("entry-row")).toHaveCount(3);
    await expect(page.getByTestId("entry-row").nth(2).getByTestId("entry-name")).toHaveText("E2E typed by hand");

    // Remove it again — the confirm() is accepted, and positions close up.
    page.once("dialog", (d) => d.accept());
    await page.getByTestId("entry-row").nth(2).getByTestId("entry-remove").click();
    await expect(page.getByTestId("entry-row")).toHaveCount(2);

    // Delete the series, and land back on the index without it.
    page.once("dialog", (d) => d.accept());
    await page.getByTestId("delete-series").click();
    await expect(page).toHaveURL(/\/series$/);
    await expect(page.getByTestId("series-card").filter({ hasText: nameFor(project) })).toHaveCount(0);
  } finally {
    // A no-op once the delete above worked; the safety net when it did not.
    await cleanUp(page, created.id);
  }
});
