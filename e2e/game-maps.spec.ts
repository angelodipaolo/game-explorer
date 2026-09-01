import { expect, test, type Page } from "@playwright/test";

/**
 * Maps, driven the way they are used: a map appears on the game page, opens
 * full screen, a location in the list flies the map to its marker, the marker
 * shows a popup. Fixtures go through the same API a skill uses and are named
 * "E2E" so a stray row is obvious; each project cleans up its own.
 */

/** A 64×64 PNG made in the browser so the image route has something real to serve. */
async function makePng(page: Page) {
  return page.evaluate(async () => {
    const c = document.createElement("canvas");
    c.width = 64;
    c.height = 64;
    const g = c.getContext("2d")!;
    g.fillStyle = "#0c3a94";
    g.fillRect(0, 0, 64, 64);
    g.fillStyle = "#2c8a2c";
    g.fillRect(16, 16, 32, 32);
    const b64 = c.toDataURL("image/png").split(",")[1];
    return b64;
  });
}

async function openContra(page: Page) {
  await page.goto("/shelf?q=Contra&platform=nes");
  await page.getByTestId("game-card").first().click();
  await expect(page.getByTestId("game-title")).toHaveText("Contra");
  return new URL(page.url()).pathname.match(/^\/game\/(.+)$/)![1];
}

/** A map with two markers, created through the same API the find-maps skill uses. */
async function createMap(page: Page, gameId: string, slug: string, b64: string) {
  return page.evaluate(
    async ([id, s, png]) => {
      const map = await (await fetch(`/api/games/${id}/maps`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: `E2E ${s}`, slug: s, subtitle: "test" }) })).json();
      const bytes = Uint8Array.from(atob(png), (c) => c.charCodeAt(0));
      const up = await fetch(`/api/maps/${map.id}/image`, { method: "PUT", body: bytes });
      if (!up.ok) throw new Error(`upload ${up.status}`);
      const r = await (
        await fetch(`/api/maps/${map.id}/markers`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ markers: [{ name: "Jungle", kind: "dungeon", x: 20, y: 20, note: "Stage 1." }, { name: "Base", kind: "boss", x: 44, y: 44 }] }),
        })
      ).json();
      if (r.skipped.length) throw new Error(JSON.stringify(r.skipped));
      return map.id as string;
    },
    [gameId, slug, b64],
  );
}

async function cleanUp(page: Page, gameId: string, slug: string) {
  await page.evaluate(
    async ([id, s]) => {
      const maps: { id: string; slug: string }[] = await (await fetch(`/api/games/${id}/maps`)).json();
      for (const m of maps) if (m.slug === s) await fetch(`/api/maps/${m.id}`, { method: "DELETE" });
    },
    [gameId, slug],
  );
}

test("a map shows on the game page and opens in the viewer", async ({ page }, testInfo) => {
  const slug = `e2e-${testInfo.project.name}`;
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));

  const gameId = await openContra(page);
  await cleanUp(page, gameId, slug);

  // Create through the API exactly as the find-maps skill does.
  const b64 = await makePng(page);
  const mapId = await createMap(page, gameId, slug, b64);

  try {
    await page.reload();
    const card = page.getByTestId("map-card").filter({ hasText: `E2E ${slug}` });
    await expect(card).toBeVisible();
    await expect(card).toContainText("2 places");
    await card.click();

    await expect(page).toHaveURL(new RegExp(`/game/${gameId}/map\\?m=${slug}`));
    await expect(page.getByTestId("map-viewer")).toBeVisible();
    await expect(page.getByTestId("map-marker")).toHaveCount(2);

    // List → fly to → popup.
    await page.getByTestId("map-location").filter({ hasText: "Jungle" }).click();
    await expect(page.getByTestId("map-popup")).toContainText("Jungle");
    await expect(page.getByTestId("map-popup")).toContainText("Stage 1.");

    // Marker → popup.
    await page.getByTestId("map-viewport").getByRole("button", { name: "Base", exact: true }).click();
    await expect(page.getByTestId("map-popup")).toContainText("Base");

    // Back to the game.
    await page.getByTestId("map-back").click();
    await expect(page.getByTestId("game-title")).toHaveText("Contra");
    expect(errors).toEqual([]);
  } finally {
    await page.evaluate((id) => fetch(`/api/maps/${id}`, { method: "DELETE" }), mapId);
  }
});

/**
 * A drag that starts ON a marker pans the map (GAMEEXPLOR-0023 round 3).
 *
 * The 44x44 marker target is the whole reason this is a test. `pointerdown`
 * used to refuse to start a pan anywhere inside a `button`, and growing the
 * markers from 28 to 44 tripled that refusal zone — 31% of a dense map's
 * surface, where a thumb drag left the transform byte-identical and the map
 * looked frozen. So: read the world transform, drag from the middle of a
 * marker, and assert it actually moved. And the tap the drag ends with must
 * not also select the marker, or every pan would open a popup.
 */
test("a drag that starts on a marker still pans the map", async ({ page }, testInfo) => {
  const slug = `e2e-pan-${testInfo.project.name}`;
  const gameId = await openContra(page);
  await cleanUp(page, gameId, slug);
  const mapId = await createMap(page, gameId, slug, await makePng(page));

  try {
    await page.goto(`/game/${gameId}/map?m=${slug}`);
    await expect(page.getByTestId("map-viewer")).toBeVisible();
    const world = page.getByTestId("map-world");
    const marker = page.getByTestId("map-viewport").getByRole("button", { name: "Jungle", exact: true });
    await expect(marker).toBeVisible();

    // Read the translation off the resolved matrix rather than the inline
    // string: the two engines serialise `transform` differently and this is
    // the number the compositor actually uses.
    const translation = () => world.evaluate((el) => { const m = new DOMMatrix(getComputedStyle(el).transform); return { x: m.e, y: m.f }; });

    const before = await translation();
    const box = (await marker.boundingBox())!;
    const from = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    // Past the 2px slop the viewer uses to tell a drag from a tap.
    await page.mouse.move(from.x + 60, from.y + 40, { steps: 10 });
    await page.mouse.up();

    const after = await translation();
    expect(after, `the transform did not change: still ${JSON.stringify(before)}`).not.toEqual(before);
    const { x: bx, y: by } = before;
    const { x: ax, y: ay } = after;
    // The drag is 60x40 over ten steps, and the first `pointermove` only seeds
    // the reference point rather than moving anything — so the pan is the drag
    // less one step (54x36). Asserted as a band rather than an exact number so
    // the step count is not load-bearing, but a band that a stationary map
    // (0, 0) or a half-swallowed one cannot sit in.
    expect(Math.round(ax - bx), "the map panned by the width of the drag").toBeGreaterThanOrEqual(54);
    expect(Math.round(ax - bx), "the map panned no further than the drag").toBeLessThanOrEqual(60);
    expect(Math.round(ay - by), "the map panned by the height of the drag").toBeGreaterThanOrEqual(36);
    expect(Math.round(ay - by), "the map panned no further than the drag").toBeLessThanOrEqual(40);

    // The pan swallowed the marker's own tap.
    await expect(page.getByTestId("map-popup")).toBeHidden();

    // And a plain tap on it still selects, so the swallow is not a mute.
    await marker.click();
    await expect(page.getByTestId("map-popup")).toContainText("Jungle");
  } finally {
    await page.evaluate((id) => fetch(`/api/maps/${id}`, { method: "DELETE" }), mapId);
  }
});
