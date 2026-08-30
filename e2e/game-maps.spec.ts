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
  await page.goto("/?q=Contra&platform=nes");
  await page.getByTestId("game-card").first().click();
  await expect(page.getByTestId("game-title")).toHaveText("Contra");
  return new URL(page.url()).pathname.match(/^\/game\/(.+)$/)![1];
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
  const mapId = await page.evaluate(
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
