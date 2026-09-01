import { expect, test, type Page } from "@playwright/test";

/**
 * Background music (GAMEEXPLOR-0025), driven the way it is used: off until you
 * turn it on, silent on a game nobody registered music for, and replaced —
 * not layered — when you walk from one game to another.
 *
 * These are the three things unit tests structurally cannot cover: the
 * autoplay-gesture rule (a policy the browser enforces, not us), the single
 * `<audio>` element mounted once in the root layout, and what happens to it on
 * a client-side navigation. Fixtures go through the same API a skill uses, are
 * titled "E2E" so a stray row is obvious, and each project cleans up its own.
 */

const audioState = (page: Page) =>
  page.evaluate(() => {
    const a = document.querySelector<HTMLAudioElement>("audio[data-testid=music-audio]");
    return a ? { src: a.getAttribute("src"), paused: a.paused, time: a.currentTime } : null;
  });

const src = async (page: Page) => (await audioState(page))?.src ?? null;

/** The card for exactly this title — "Mega Man" must not open "Mega Man 2". */
const cardFor = (page: Page, title: string) => page.getByTestId("game-card").filter({ has: page.getByText(title, { exact: true }) }).first();

/** Open a game from the shelf and hand back its owned-copy id — the id the music API is keyed on. */
async function openGame(page: Page, title: string) {
  await page.goto(`/shelf?q=${encodeURIComponent(title)}`);
  await cardFor(page, title).click();
  await expect(page.getByTestId("game-title")).toHaveText(title);
  return new URL(page.url()).pathname.match(/^\/game\/([^/]+)/)![1];
}

/**
 * Register a track and upload its bytes, exactly as the curate-collection
 * skill does. The audio is a few seconds of MPEG-1 Layer III silence built in
 * the browser — real frame headers, zeroed payloads — because this repo does
 * not carry audio files and no test ever reads the owner's own music.
 */
async function addTrack(page: Page, gameId: string, title: string) {
  return page.evaluate(
    async ([id, name]) => {
      const res = await fetch(`/api/games/${id}/music`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: name }) });
      if (!res.ok) throw new Error(`create ${res.status}`);
      const track = await res.json();
      const frames = 80;
      const bytes = new Uint8Array(417 * frames);
      for (let i = 0; i < frames; i++) bytes.set([0xff, 0xfb, 0x90, 0x64], i * 417);
      const up = await fetch(`/api/music/${track.id}/audio`, { method: "PUT", body: bytes });
      if (!up.ok) throw new Error(`upload ${up.status}`);
      return track.id as string;
    },
    [gameId, title] as const,
  );
}

async function removeTracks(page: Page, ids: string[]) {
  await page.evaluate(async (list) => {
    for (const id of list) await fetch(`/api/music/${id}`, { method: "DELETE" });
  }, ids);
}

/**
 * Drop every "E2E "-titled track on this copy before seeding a new one.
 *
 * A track is picked at random, so a leftover from an interrupted run would
 * make the next one flaky rather than red — the failure would look like the
 * player choosing wrongly. Only fixtures are touched: a real track is never
 * titled "E2E …", and this never deletes a game's whole soundtrack.
 */
async function clearFixtures(page: Page, gameId: string) {
  await page.evaluate(async (id) => {
    const { tracks } = await (await fetch(`/api/games/${id}/music`)).json();
    for (const t of tracks as { id: string; title: string }[]) {
      if (t.title.startsWith("E2E ")) await fetch(`/api/music/${t.id}`, { method: "DELETE" });
    }
  }, gameId);
}

/**
 * A game nobody else in this run will touch.
 *
 * The desktop and phone projects run in parallel workers against one database,
 * and a track is chosen at random — so two projects seeding the same copy would
 * make each other flaky. A project therefore gets its own pair of games rather
 * than sharing Contra.
 */
const FIXTURE_GAMES: Record<string, [string, string]> = {
  desktop: ["Contra", "Mega Man"],
  phone: ["Excitebike", "Metroid"],
};
const gamesFor = (project: string) => FIXTURE_GAMES[project] ?? FIXTURE_GAMES.desktop;

const enableMusic = (page: Page) =>
  page.evaluate(() => {
    localStorage.setItem("game-explorer:music", JSON.stringify({ enabled: true, volume: 0.2 }));
  });

test("music stays off until you turn it on, then waits for a tap", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  const [title] = gamesFor(testInfo.project.name);
  const gameId = await openGame(page, title);
  await clearFixtures(page, gameId);
  const trackId = await addTrack(page, gameId, `E2E ${testInfo.project.name} theme`);

  try {
    // Default off: a registered game is still silent, and nothing is offered.
    await page.reload();
    expect(await src(page)).toBeNull();
    await expect(page.getByTestId("music-start")).toBeHidden();

    // On, but this document has seen no gesture — so the track is loaded and
    // paused, and the tap affordance appears instead of a console error.
    await enableMusic(page);
    await page.reload();
    await expect.poll(() => src(page)).toBe(`/api/music/${trackId}/audio`);
    await expect(page.getByTestId("music-start")).toBeVisible();
    expect((await audioState(page))?.paused).toBe(true);

    // The affordance is itself the gesture.
    await page.getByTestId("music-start").click();
    await expect(page.getByTestId("music-start")).toBeHidden();
    await expect.poll(async () => (await audioState(page))?.time ?? 0, { timeout: 10_000 }).toBeGreaterThan(0);

    // One element, mounted once in the root layout.
    expect(await page.locator("audio").count()).toBe(1);
    expect(errors).toEqual([]);
  } finally {
    await removeTracks(page, [trackId]);
    await clearFixtures(page, gameId);
  }
});

test("walking from one game to another replaces the track", async ({ page }, testInfo) => {
  const [first, second] = gamesFor(testInfo.project.name);
  const firstId = await openGame(page, first);
  const secondId = await openGame(page, second);
  let firstTrack = "";
  let secondTrack = "";

  try {
    await clearFixtures(page, firstId);
    await clearFixtures(page, secondId);
    firstTrack = await addTrack(page, firstId, `E2E ${testInfo.project.name} ${first}`);
    secondTrack = await addTrack(page, secondId, `E2E ${testInfo.project.name} ${second}`);

    await enableMusic(page);
    // Reached by clicking a card, so the tap that opened the page is the
    // gesture and playback starts on its own — the ordinary way in.
    await openGame(page, first);
    await expect.poll(() => src(page)).toBe(`/api/music/${firstTrack}/audio`);
    await expect.poll(async () => (await audioState(page))?.time ?? 0, { timeout: 10_000 }).toBeGreaterThan(0);

    // Back to the shelf: not a game page, so the audio stops and lets go of
    // the request rather than playing on under the grid.
    await page.getByTestId("back-link").click();
    await expect(page).toHaveURL(/\/shelf/);
    await expect.poll(() => src(page)).toBeNull();

    // And on to the other game, without a page load: the incoming track
    // replaces the outgoing one, and the outgoing one is never left playing
    // over the new game's page.
    await page.getByPlaceholder("Search the shelf").fill(second);
    await cardFor(page, second).click();
    await expect(page.getByTestId("game-title")).toHaveText(second);
    await expect.poll(() => src(page)).toBe(`/api/music/${secondTrack}/audio`);
    expect(await page.locator("audio").count()).toBe(1);

    // A game whose tracks are gone is silent, with nothing offered.
    await removeTracks(page, [secondTrack]);
    await page.reload();
    await expect.poll(() => src(page)).toBeNull();
    await expect(page.getByTestId("music-start")).toBeHidden();
  } finally {
    await removeTracks(page, [firstTrack, secondTrack].filter(Boolean));
    await clearFixtures(page, firstId);
    await clearFixtures(page, secondId);
  }
});
