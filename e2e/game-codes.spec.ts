import { expect, test, type Page } from "@playwright/test";

/**
 * Codes on a game page, driven the way they are actually used: open a game,
 * add a code, read it back, copy it, then delete it. Runs on desktop and
 * phone. Writes to the live dev database, so every test cleans up after
 * itself — the fixtures are named "E2E" so a stray row is obvious.
 */

/**
 * The desktop and phone projects run in parallel against the same game, so
 * every fixture is namespaced by project — otherwise one worker's clean-up
 * deletes the other worker's row mid-test.
 */
const effectFor = (project: string) => `E2E ${project} infinite lives`;
const CODE = "SXIOPO";

async function openContra(page: Page) {
  await page.goto("/shelf?q=Contra&platform=nes");
  await page.getByTestId("game-card").first().click();
  await expect(page.getByTestId("game-title")).toHaveText("Contra");
}

/** Remove any E2E row left behind, through the same API the page uses. */
async function cleanUp(page: Page, effect: string) {
  const id = new URL(page.url()).pathname.match(/^\/game\/(.+)$/)?.[1];
  if (!id) throw new Error(`cleanUp needs a game page, got ${page.url()}`);
  await page.evaluate(
    async ([gameId, prefix]) => {
      const codes: { id: string; effect: string }[] = await (await fetch(`/api/games/${gameId}/codes`)).json();
      for (const c of codes) if (c.effect.startsWith(prefix)) await fetch(`/api/games/${gameId}/codes/${c.id}`, { method: "DELETE" });
    },
    [id, effect],
  );
}

test("a code can be added, read, edited and deleted from the game page", async ({ page }, testInfo) => {
  const EFFECT = effectFor(testInfo.project.name);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
  page.on("dialog", (d) => d.accept());

  await openContra(page);
  await cleanUp(page, EFFECT);
  await page.reload();

  await page.getByTestId("add-code").click();
  await page.getByTestId("code-effect").fill(EFFECT);
  await page.getByTestId("code-value").fill(CODE);
  await page.getByTestId("save-code").click();

  const row = page.getByTestId("code-row").filter({ hasText: EFFECT });
  await expect(row).toBeVisible();
  await expect(row).toContainText(CODE);

  // Edit it in place.
  await page.getByTestId("edit-codes").click();
  await row.getByRole("button", { name: `Edit ${EFFECT}` }).click();
  await page.getByTestId("code-effect").fill(`${EFFECT} revised`);
  await page.getByTestId("save-code").click();
  const edited = page.getByTestId("code-row").filter({ hasText: `${EFFECT} revised` });
  await expect(edited).toBeVisible();

  // And delete it. Saving leaves the section in edit mode, so the row is still editable.
  await edited.getByRole("button", { name: /^Edit / }).click();
  await page.getByTestId("delete-code").click();
  await expect(page.getByTestId("code-row").filter({ hasText: EFFECT })).toHaveCount(0);

  expect(errors, "console errors").toEqual([]);
});

test("the copy button is a real tap target and copies the code", async ({ page, browserName, context }, testInfo) => {
  const EFFECT = effectFor(testInfo.project.name);
  page.on("dialog", (d) => d.accept());
  if (browserName === "chromium") await context.grantPermissions(["clipboard-read", "clipboard-write"]);

  await openContra(page);
  await cleanUp(page, EFFECT);
  await page.reload();
  await page.getByTestId("add-code").click();
  await page.getByTestId("code-effect").fill(EFFECT);
  await page.getByTestId("code-value").fill(CODE);
  await page.getByTestId("save-code").click();

  const copy = page.getByTestId("code-row").filter({ hasText: EFFECT }).getByTestId("copy-code");
  await expect(copy).toBeVisible();
  // One-handed use: at least a 44px target on every width.
  const box = (await copy.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.width).toBeGreaterThanOrEqual(44);

  await copy.click();
  if (browserName === "chromium") {
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(CODE);
    await expect(copy).toHaveText("✓");
  }

  await cleanUp(page, EFFECT);
});

test("a game with no codes shows only the affordance", async ({ page, request }) => {
  // Ask the gaps endpoint for a copy that genuinely has none, rather than
  // assuming a fixture game is empty — the shelf gains codes over time.
  const { gaps } = await (await request.get("/api/codes/gaps?limit=1")).json();
  expect(gaps.length, "every owned copy already has codes").toBe(1);
  await page.goto(`/game/${gaps[0].ownedGameId}`);
  await expect(page.getByTestId("add-code")).toBeVisible();
  await expect(page.getByTestId("edit-codes")).toHaveCount(0);
  await expect(page.getByTestId("code-row")).toHaveCount(0);
});

test("a code written through the batch API is an ordinary row on the page", async ({ page }, testInfo) => {
  const EFFECT = effectFor(testInfo.project.name);
  page.on("dialog", (d) => d.accept());
  await openContra(page);
  await cleanUp(page, EFFECT);
  const id = new URL(page.url()).pathname.split("/").pop()!;
  const result = await page.evaluate(
    async ([gameId, effect]) => {
      const res = await fetch("/api/codes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ codes: [{ ownedGameId: gameId, kind: "game-genie", effect, code: "AAAAAA", sourceUrl: "https://example.test/e2e" }] }),
      });
      return res.json();
    },
    [id, `${EFFECT} from a batch`],
  );
  expect(result.written).toHaveLength(1);

  await page.reload();
  const row = page.getByTestId("code-row").filter({ hasText: `${EFFECT} from a batch` });
  await expect(row).toBeVisible();
  // No provenance badge: it is editable and deletable exactly like a typed-in one.
  await expect(row.getByRole("link", { name: "Source" })).toBeVisible();
  await page.getByTestId("edit-codes").click();
  await row.getByRole("button", { name: /^Edit / }).click();
  await page.getByTestId("delete-code").click();
  await expect(page.getByTestId("code-row").filter({ hasText: EFFECT })).toHaveCount(0);
});

/**
 * Price link-outs live on the same page, so they ride along here rather than
 * in a spec of their own. Count-agnostic on purpose: there is one row per
 * owned copy, and Contra may gain a second platform.
 */
test("the game page links out to price lookups", async ({ page }) => {
  await openContra(page);
  await expect(page.getByTestId("lookup-links")).toBeVisible();

  const hrefs = await page.getByTestId("lookup-link").evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).href));
  expect(hrefs.length).toBeGreaterThanOrEqual(3);
  const hosts = hrefs.map((h) => new URL(h).hostname);
  expect(hosts.filter((h) => h.endsWith("pricecharting.com")).length).toBeGreaterThanOrEqual(1);
  // Active listings and completed sales.
  expect(hosts.filter((h) => h.endsWith("ebay.com")).length).toBeGreaterThanOrEqual(2);
  expect(hosts.every((h) => h.endsWith("pricecharting.com") || h.endsWith("ebay.com")), hosts.join(" ")).toBe(true);
});
