import { expect, test, type Page } from "@playwright/test";

/**
 * A run, start to finish, the way it actually happens: find something you have
 * never played, tap Start playing, write a line about it, tap Finished.
 *
 * Runs against the live dev database on both projects, so it picks its own
 * game out of `?play=never` rather than naming a fixture — and picks a
 * different one per project, because a copy can only have one open run and the
 * two projects run in parallel.
 *
 * Two rules follow from that database being the owner's real collection:
 *  - it never deletes anything it did not create (see `cleanUp`), and
 *  - it refuses to run rather than pick a copy that already has history on it.
 */

const noteFor = (project: string) => `E2E ${project} — stuck on the third boss`;

/** Far apart so that one project consuming a never-played game cannot shift the other onto it. */
const indexFor = (project: string) => (project === "phone" ? 5 : 0);

/** Each project takes its index and the one after it, so the shelf needs 7 never-played games. */
const NEEDED = indexFor("phone") + 2;

type CopyState = { runs: number; queued: boolean };

async function stateOf(page: Page, gameId: string): Promise<CopyState> {
  return page.evaluate(async (id) => {
    const runs: unknown[] = await (await fetch(`/api/games/${id}/sessions`)).json();
    const queue: { ownedGameId: string }[] = await (await fetch("/api/queue")).json();
    return { runs: runs.length, queued: queue.some((q) => q.ownedGameId === id) };
  }, gameId);
}

/**
 * Open the nth never-played game and hand back its owned id, after checking
 * the copy is untouched: no runs, not queued. That check is what makes the
 * cleanup at the end safe — everything on the copy afterwards is this test's.
 */
async function openNeverPlayed(page: Page, index: number): Promise<string> {
  await page.goto("/shelf?play=never&sort=title");
  await expect(page.getByTestId("result-count")).toContainText(/game/);
  const cards = page.getByTestId("game-card");
  await expect(cards.first()).toBeVisible();
  const available = await cards.count();
  test.skip(available < NEEDED, `needs ${NEEDED} never-played games on the shelf to give both projects their own; found ${available}`);

  await cards.nth(index).click();
  await expect(page.getByTestId("game-title")).toBeVisible();
  const id = new URL(page.url()).pathname.split("/").pop()!;

  const before = await stateOf(page, id);
  expect(before.runs, `picked copy ${id} already has runs — leftovers from an earlier failed run?`).toBe(0);
  expect(before.queued, `picked copy ${id} is already in the queue — leftovers from an earlier failed run?`).toBe(false);
  return id;
}

/**
 * Remove exactly what this spec created. The copy had no runs and no queue
 * entry when it was picked, so every run on it now is one of ours; journal
 * entries are matched on the note this project writes, because the copy may
 * well have entries of the owner's that predate any run.
 */
async function cleanUp(page: Page, gameId: string, note: string) {
  await page.evaluate(
    async ([id, written]) => {
      const entries: { id: string; body: string | null }[] = await (await fetch(`/api/games/${id}/journal`)).json();
      for (const e of entries) if (e.body === written) await fetch(`/api/journal/${e.id}`, { method: "DELETE" });
      const runs: { id: string }[] = await (await fetch(`/api/games/${id}/sessions`)).json();
      for (const r of runs) await fetch(`/api/sessions/${r.id}`, { method: "DELETE" });
      // Only when it is actually queued: a DELETE that 404s is a console error,
      // and this spec asserts the console is clean.
      const queue: { ownedGameId: string }[] = await (await fetch("/api/queue")).json();
      if (queue.some((q) => q.ownedGameId === id)) await fetch(`/api/queue/${id}`, { method: "DELETE" });
    },
    [gameId, note],
  );
}

test("start a run, write a note on it, finish the run", async ({ page }, testInfo) => {
  const NOTE = noteFor(testInfo.project.name);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("dialog", (d) => d.accept());

  const id = await openNeverPlayed(page, indexFor(testInfo.project.name));

  // Never played: one primary affordance and no runs.
  await expect(page.getByTestId("run-row")).toHaveCount(0);
  await page.getByTestId("start-run").click();
  await expect(page.getByTestId("open-run")).toBeVisible();
  await expect(page.getByTestId("open-run")).toContainText("Playing since");

  // The composer sits behind a "＋ Add a note" button now (GAMEEXPLOR-0023),
  // and the Journal section itself collapses at rest when it is empty (round
  // 2, item E) — a never-played game starts with none, so open it first.
  const journalToggle = page.getByTestId("section-toggle-journal");
  if ((await journalToggle.getAttribute("aria-expanded")) !== "true") await journalToggle.click();
  await page.getByTestId("journal-add-note").click();

  // While a run is open, what you write defaults to it — visibly, as a chip.
  await expect(page.getByTestId("journal-run-chip")).toBeVisible();
  await page.getByTestId("journal-body").fill(NOTE);
  await page.getByTestId("journal-save").click();
  const entry = page.getByTestId("journal-entry").filter({ hasText: NOTE });
  await expect(entry).toBeVisible();

  // The chip was not decoration: the entry really is filed under the open run.
  const filed = await page.evaluate(
    async ([gameId, written]) => {
      const entries: { body: string | null; sessionId: string | null }[] = await (await fetch(`/api/games/${gameId}/journal`)).json();
      return entries.filter((e) => e.body === written && e.sessionId).length;
    },
    [id, NOTE],
  );
  expect(filed, "the entry is filed under the open run").toBe(1);

  // Finish it: the open run becomes a closed one and the primary action changes.
  const finish = page.getByTestId("finish-run");
  const box = (await finish.boundingBox())!;
  expect(box.height, "one-handed tap target").toBeGreaterThanOrEqual(44);
  await finish.click();
  await expect(page.getByTestId("open-run")).toHaveCount(0);
  await expect(page.getByTestId("play-again")).toBeVisible();
  await expect(page.getByTestId("run-row").filter({ hasText: "Finished it" })).toHaveCount(1);
  // The writing survives the run being closed.
  await expect(page.getByTestId("journal-entry").filter({ hasText: NOTE })).toBeVisible();

  // No horizontal scroll at any width this runs at.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow, "horizontal overflow").toBeLessThanOrEqual(1);

  await cleanUp(page, id, NOTE);
  expect(await stateOf(page, id), "the copy is left exactly as it was found").toEqual({ runs: 0, queued: false });
  expect(errors, "console errors").toEqual([]);
});

test("a queued game can be started from Now playing", async ({ page }, testInfo) => {
  const NOTE = noteFor(testInfo.project.name);
  page.on("dialog", (d) => d.accept());
  const id = await openNeverPlayed(page, indexFor(testInfo.project.name) + 1);
  const title = (await page.getByTestId("game-title").textContent())!;

  await page.getByTestId("queue-add").click();
  await expect(page.getByTestId("queue-remove")).toBeVisible();

  await page.goto("/playing");
  const row = page.getByTestId("queue-row").filter({ hasText: title });
  await expect(row).toBeVisible();

  // Starting it drops it out of the queue and up into In progress, in one refresh.
  await row.getByTestId("queue-play-now").click();
  await expect(page.getByTestId("playing-row").filter({ hasText: title })).toBeVisible();
  await expect(page.getByTestId("queue-row").filter({ hasText: title })).toHaveCount(0);

  await page.goto(`/game/${id}`);
  await expect(page.getByTestId("open-run")).toBeVisible();

  await cleanUp(page, id, NOTE);
  expect(await stateOf(page, id), "the copy is left exactly as it was found").toEqual({ runs: 0, queued: false });
});
