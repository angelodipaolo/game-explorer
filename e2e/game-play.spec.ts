import { expect, test, type Page } from "@playwright/test";

/**
 * Dates on a run, at the precision they were claimed at (GAMEEXPLOR-0037).
 *
 * Three things this file exists to pin, in order of how expensive they would
 * be to get wrong:
 *
 * 1. **The one-tap path did not grow a prompt.** "Start playing" is the button
 *    the whole app exists for; a date question in front of it would be the
 *    worst possible outcome of a ticket about dates.
 * 2. **A month renders as a month.** "Aug 2026", never "1 Aug 2026" — on the
 *    row, in the banner and on `/playing`.
 * 3. **`<input type="month">` degrades, and the fallback catches it.** The
 *    phone project is WebKit, where the control reflects back as `type=text`
 *    and any string typed into it survives. That is not a hypothetical: it is
 *    what `Version/26.5 Safari/605.1.15` does today. Whichever control this
 *    engine gets, a month must be enterable and must arrive as `YYYY-MM`.
 *
 * Same rules as `game-journal.spec.ts`, and for the same reason — this runs
 * against the live dev database: pick a never-played copy, refuse to run
 * rather than touch one with history, and delete only what was created.
 */

/**
 * Far from the indices `game-journal.spec.ts` takes, because the projects run
 * in parallel — and one index per test rather than one per project, so a
 * cleanup that has not settled cannot make the next test pick a copy it just
 * finished with.
 */
const indexFor = (project: string) => (project === "phone" ? 12 : 9);
const NEEDED = indexFor("phone") + 3;

const noteFor = (project: string) => `E2E ${project} — month precision`;

type CopyState = { runs: number; queued: boolean };

async function stateOf(page: Page, gameId: string): Promise<CopyState> {
  return page.evaluate(async (id) => {
    const runs: unknown[] = await (await fetch(`/api/games/${id}/sessions`)).json();
    const queue: { ownedGameId: string }[] = await (await fetch("/api/queue")).json();
    return { runs: runs.length, queued: queue.some((q) => q.ownedGameId === id) };
  }, gameId);
}

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
  expect(before.queued, `picked copy ${id} is already in the queue`).toBe(false);
  return id;
}

async function cleanUp(page: Page, gameId: string) {
  await page.evaluate(async (id) => {
    const runs: { id: string }[] = await (await fetch(`/api/games/${id}/sessions`)).json();
    for (const r of runs) await fetch(`/api/sessions/${r.id}`, { method: "DELETE" });
    const queue: { ownedGameId: string }[] = await (await fetch("/api/queue")).json();
    if (queue.some((q) => q.ownedGameId === id)) await fetch(`/api/queue/${id}`, { method: "DELETE" });
  }, gameId);
}

/**
 * Put a month into whichever control this engine drew. `fill` works on the
 * native `type="month"` and on WebKit's text-box degradation alike; the
 * `<select>` pair is a different shape and is driven by its two halves.
 */
async function enterMonth(page: Page, testId: string, value: string) {
  const [year, month] = value.split("-");
  const paired = page.getByTestId(`${testId}-month`);
  if (await paired.count()) {
    await paired.selectOption(month);
    await page.getByTestId(`${testId}-year`).selectOption(year);
    return;
  }
  await page.getByTestId(testId).fill(value);
}

test("the one-tap start is still one tap, and records today", async ({ page }, testInfo) => {
  page.on("dialog", (d) => d.accept());
  const id = await openNeverPlayed(page, indexFor(testInfo.project.name));

  await expect(page.getByTestId("run-row")).toHaveCount(0);
  await page.getByTestId("start-run").click();

  // No prompt, no modal, no confirm — the run is open before anything else
  // renders, and the date it recorded is today, at day precision.
  await expect(page.getByTestId("open-run")).toBeVisible();
  await expect(page.getByTestId("run-form")).toHaveCount(0);
  const started = await page.evaluate(async (gameId) => {
    const runs: { startedAt: string; startedPrecision: string; endedAt: string | null }[] = await (await fetch(`/api/games/${gameId}/sessions`)).json();
    return runs[0];
  }, id);
  expect(started.startedPrecision).toBe("day");
  expect(started.endedAt).toBeNull();
  expect(new Date(started.startedAt).toDateString()).toBe(new Date().toDateString());

  await cleanUp(page, id);
  expect(await stateOf(page, id), "the copy is left exactly as it was found").toEqual({ runs: 0, queued: false });
});

test("a backdated run opened from the form, at month precision, all the way to /playing", async ({ page }, testInfo) => {
  const NOTE = noteFor(testInfo.project.name);
  page.on("dialog", (d) => d.accept());
  const id = await openNeverPlayed(page, indexFor(testInfo.project.name) + 1);
  const title = (await page.getByTestId("game-title").textContent())!;

  // A copy with no runs keeps the add affordance in the section header.
  await page.getByTestId("add-past-run-empty").click();
  await expect(page.getByTestId("run-form")).toBeVisible();

  // The default unit of entry is a month, and whatever control this engine
  // drew must be a real one. A bare text box is the failure this guards:
  // WebKit degrades `<input type="month">` to exactly that, and free text is
  // not a value the API will take, so the form would be worse than the two
  // date inputs it replaced.
  const control = await page.evaluate(() => {
    const el = document.querySelector<HTMLInputElement>('[data-testid="run-started"]');
    if (el) return el.type;
    return document.querySelector('[data-testid="run-started-month"]') ? "paired-select" : "missing";
  });
  expect(["month", "paired-select"], `the month field degraded to "${control}"`).toContain(control);
  if (control === "month") await expect(page.getByTestId("run-started")).toHaveValue(/^\d{4}-\d{2}$/);

  // The third outcome — the whole feature. Choosing it removes the end date
  // from the DOM, because a `required` input that is merely hidden blocks the
  // form with no visible error.
  await page.getByTestId("run-outcome").selectOption("playing");
  await expect(page.getByTestId("run-ended")).toHaveCount(0);
  await expect(page.getByTestId("run-ended-month")).toHaveCount(0);

  await enterMonth(page, "run-started", "2019-05");
  await page.getByTestId("run-note").fill(NOTE);
  await page.getByTestId("save-run").click();

  // It is open, and it is the first row — above every closed run, whatever
  // year it was backdated to.
  await expect(page.getByTestId("open-run")).toContainText("Playing since May 2019");
  await expect(page.getByTestId("run-row").first()).toContainText("May 2019 — now");
  // Never the day. That is the whole ticket.
  await expect(page.getByTestId("run-row").first()).not.toContainText("1 May 2019");

  const stored = await page.evaluate(async (gameId) => {
    const runs: { startedAt: string; startedPrecision: string; endedAt: string | null }[] = await (await fetch(`/api/games/${gameId}/sessions`)).json();
    return runs[0];
  }, id);
  expect(stored.startedPrecision).toBe("month");
  expect(stored.endedAt, "the form opened a run rather than logging a closed one").toBeNull();

  // `/playing` reads the same precision, on the page the owner looks at most.
  await page.goto("/playing");
  const row = page.getByTestId("playing-row").filter({ hasText: title });
  await expect(row).toContainText("since May 2019");
  await expect(row).not.toContainText("1 May 2019");

  await cleanUp(page, id);
  expect(await stateOf(page, id), "the copy is left exactly as it was found").toEqual({ runs: 0, queued: false });
});

test("an open run's start date can be edited, and the whole page moves with it", async ({ page }, testInfo) => {
  page.on("dialog", (d) => d.accept());
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  const id = await openNeverPlayed(page, indexFor(testInfo.project.name) + 2);
  await page.getByTestId("start-run").click();
  await expect(page.getByTestId("open-run")).toBeVisible();

  // The open run is a row in the list now, and the heading counts it: the two
  // used to disagree, because the list filtered on `endedAt` and the count did
  // not.
  await expect(page.getByTestId("run-row")).toHaveCount(1);
  await page.getByTestId("edit-runs").click();
  await page.getByTestId("run-row").first().getByRole("button", { name: /^Edit the run/ }).click();

  // Editing an open run: no end date, no "I don't know when this was", and the
  // outcome is seeded to "Still playing". Seeding it to "Finished it" — which
  // the form used to do — is a 400 since GAMEEXPLOR-0038, not a no-op.
  await expect(page.getByTestId("run-outcome")).toHaveValue("playing");
  await expect(page.getByTestId("run-ended")).toHaveCount(0);
  await expect(page.getByTestId("run-undated-toggle")).toHaveCount(0);

  // Today's run was started at day precision, so the form opens on a day and
  // "by month instead" is the way down the ladder.
  await page.getByTestId("run-grain").click();
  await enterMonth(page, "run-started", "2019-05");
  await page.getByTestId("save-run").click();

  await expect(page.getByTestId("open-run")).toContainText("Playing since May 2019");
  await expect(page.getByTestId("run-row").first()).toContainText("May 2019 — now");

  await cleanUp(page, id);
  expect(await stateOf(page, id), "the copy is left exactly as it was found").toEqual({ runs: 0, queued: false });
  expect(errors, "console errors").toEqual([]);
});
