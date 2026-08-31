import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

/**
 * Auth (GAMEEXPLOR-0002), end to end.
 *
 * The rest of the suite runs against `npm run dev` on :3000, which runs in the
 * "open" mode (`AUTH_OPEN=1`, set by both the dev script and
 * `playwright.config.ts`) — gating it would mean setting up credentials to run
 * any test.
 * So this spec brings up **its own server**: `next start` on a spare port with
 * `OWNER_PASSWORD` / `AUTH_SECRET` / `API_TOKENS` set, from the production
 * build `npm run check` has already made. Dev and start no longer fight over
 * `.next` in Next 16 (dev writes `.next/dev`, build writes `.next/build`), so
 * this runs happily beside the dev server.
 *
 * One port per project, because desktop and phone run the file in parallel.
 *
 * It reads the live database like every other spec and writes nothing to it:
 * everything here is about which controls are drawn and which status codes
 * come back.
 */

const PASSWORD = "e2e-owner-password";
const SECRET = "e2e-signing-secret-not-a-real-one";
const TOKEN = "e2e-api-token";

const PORTS: Record<string, number> = { desktop: 3111, phone: 3112 };

let server: ChildProcessWithoutNullStreams | null = null;
let base = "";
let log = "";

test.beforeAll(async ({}, testInfo) => {
  const port = PORTS[testInfo.project.name] ?? 3113;
  base = `http://127.0.0.1:${port}`;
  server = spawn(path.join(process.cwd(), "node_modules/.bin/next"), ["start", "-p", String(port)], {
    env: { ...process.env, OWNER_PASSWORD: PASSWORD, AUTH_SECRET: SECRET, API_TOKENS: `e2e:${TOKEN}` },
  });
  server.stdout.on("data", (d) => (log += d));
  server.stderr.on("data", (d) => (log += d));

  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const res = await fetch(`${base}/login`);
      if (res.ok) return;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error(`the authed server never came up on ${base}. Run \`npm run build\` first.\n${log}`);
    await new Promise((r) => setTimeout(r, 250));
  }
});

test.afterAll(() => {
  server?.kill("SIGTERM");
});

/** Contra on the NES — the fixture the codes and journal specs also open. */
async function openContra(page: Page) {
  await page.goto(`${base}/shelf?q=Contra&platform=nes`);
  await page.getByTestId("game-card").first().click();
  await expect(page.getByTestId("game-title")).toHaveText("Contra");
}

async function signIn(page: Page, next = "/") {
  await page.goto(`${base}/login?next=${encodeURIComponent(next)}`);
  await page.getByTestId("password").fill(PASSWORD);
  await page.getByTestId("sign-in").click();
}

test("a signed-out visitor reads a game page and finds nothing to press", async ({ page }) => {
  await openContra(page);

  // Everything the page is *about* is still there.
  await expect(page.getByTestId("tag-editor")).toBeVisible();
  await expect(page.getByTestId("play-history")).toBeVisible();
  await expect(page.getByTestId("facts")).toBeVisible();

  // None of the ways to change it are.
  for (const id of ["edit-tags", "add-code", "edit-codes", "start-run", "play-again", "add-past-run", "queue-add", "journal-composer", "edit-journal", "add-bookmark", "edit-bookmarks"]) {
    await expect(page.getByTestId(id), `${id} must not render for a visitor`).toHaveCount(0);
  }

  // Nor is the Import link offered, since /import would only redirect.
  await expect(page.locator('[data-testid="nav-import"]')).toHaveCount(0);
});

test("/import, /series/new and a series' edit page send a visitor to the login page", async ({ page }) => {
  await page.goto(`${base}/import`);
  await expect(page).toHaveURL(/\/login\?next=%2Fimport$/);
  await expect(page.getByTestId("login-form")).toBeVisible();

  await page.goto(`${base}/series/new`);
  await expect(page).toHaveURL(/\/login\?next=%2Fseries%2Fnew$/);

  // The slug is part of the path, so the rule is a pattern — and it must turn
  // a visitor away before the page renders, whether or not the series exists.
  // Hiding the "Edit" control is a courtesy; this is the fence.
  await page.goto(`${base}/series/no-such-series/edit`);
  await expect(page).toHaveURL(/\/login\?next=%2Fseries%2Fno-such-series%2Fedit$/);

  // …while the series page itself stays public.
  await page.goto(`${base}/series`);
  await expect(page).toHaveURL(`${base}/series`);
  await expect(page.getByTestId("new-series")).toHaveCount(0);

  // And a real series page draws no Edit control for a visitor. Worth its own
  // assertion: every other spec runs with AUTH_OPEN=1, where `canEdit` is
  // always true, so this is the only place a dropped `canEdit ?` guard on that
  // control would be caught.
  const card = page.getByTestId("series-card").first();
  if (await card.count()) {
    await card.click();
    await expect(page.getByTestId("series-title")).toBeVisible();
    await expect(page.getByTestId("edit-series")).toHaveCount(0);
  }
});

test("a wrong password says so and changes nothing", async ({ page }) => {
  await page.goto(`${base}/login`);
  await page.getByTestId("password").fill("not the password");
  await page.getByTestId("sign-in").click();
  await expect(page.getByTestId("login-error")).toContainText("wrong password");
  await page.goto(`${base}/import`);
  await expect(page).toHaveURL(/\/login/);
});

test("signing in brings the edit controls back, on this phone and this desktop", async ({ page }) => {
  await signIn(page, "/import");
  // `next` is honoured: the page that turned you away is the one you land on.
  await expect(page).toHaveURL(`${base}/import`);

  await openContra(page);
  await expect(page.getByTestId("edit-tags")).toBeVisible();
  await expect(page.getByTestId("add-code")).toBeVisible();
  await expect(page.getByTestId("journal-composer")).toBeVisible();
  await expect(page.getByTestId("add-bookmark")).toBeVisible();
  await expect(page.locator('[data-testid="start-run"], [data-testid="play-again"]')).toHaveCount(1);

  // And the way back out is where the sign-in link was.
  await page.goto(`${base}/shelf`);
  await page.getByTestId("open-filters").click();
  await expect(page.getByTestId("sign-out")).toBeVisible();
});

test("the sign-in link is in the filter sheet, not the header", async ({ page }) => {
  await page.goto(`${base}/shelf`);
  await page.getByTestId("open-filters").click();
  await expect(page.getByTestId("sign-in-link")).toBeVisible();
});

test("the API refuses everything but the images without credentials", async ({ request }) => {
  const gameId = "does-not-exist";

  // A write.
  const write = await request.put(`${base}/api/games/${gameId}/tags`, { data: { tag: "E2E should never land" } });
  expect(write.status()).toBe(401);
  expect(await write.json()).toEqual({ error: "unauthorized" });

  // A read: the agent-facing GETs are gated too.
  expect((await request.get(`${base}/api/tags`)).status()).toBe(401);
  expect((await request.get(`${base}/api/codes/gaps`)).status()).toBe(401);

  // The one exemption: cover art, which every public page is made of.
  const shelf = await (await request.get(`${base}/shelf`)).text();
  const img = shelf.match(/\/api\/img\/[^"&?]+/)?.[0];
  expect(img, "the shelf should render at least one cover").toBeTruthy();
  const image = await request.get(`${base}${img}`);
  expect(image.status()).toBe(200);
  expect(image.headers()["content-type"]).toMatch(/^image\//);
});

test("a bearer token is accepted, a wrong one is not", async ({ request }) => {
  const ok = await request.get(`${base}/api/tags`, { headers: { authorization: `Bearer ${TOKEN}` } });
  expect(ok.status()).toBe(200);
  expect(Array.isArray(await ok.json())).toBe(true);

  const bad = await request.get(`${base}/api/tags`, { headers: { authorization: "Bearer wrong-token" } });
  expect(bad.status()).toBe(401);
});

test("signing in over the API sets a cookie that the API then accepts", async ({ request }) => {
  expect((await request.get(`${base}/api/tags`)).status()).toBe(401);
  const login = await request.post(`${base}/api/auth/login`, { data: { password: PASSWORD } });
  expect(login.status()).toBe(200);
  const cookie = login.headers()["set-cookie"];
  expect(cookie).toContain("gx_session=");
  expect(cookie).toContain("HttpOnly");
  expect(cookie).toContain("SameSite=lax");
  // 30 days.
  expect(cookie).toContain(`Max-Age=${60 * 60 * 24 * 30}`);

  // The request context kept the cookie, so the same call now works.
  expect((await request.get(`${base}/api/tags`)).status()).toBe(200);

  await request.post(`${base}/api/auth/logout`, { data: {} });
  expect((await request.get(`${base}/api/tags`)).status()).toBe(401);
});

test("a traversal id on the public image routes reads nothing", async ({ request }) => {
  // These three GETs are the only unauthenticated routes that turn a URL
  // segment into a file path. `%2F` arrives decoded, so `..%2F..%2F` used to
  // walk straight out of data/maps and read any file the server could open.
  const ids = ["..%2F..%2F..%2F..%2Fetc%2Fhosts", "..%2F..%2Fpackage.json", "..%2F..%2Fprisma%2Fdev.db", "..%5C..%5Cpackage.json", "%2Fetc%2Fhosts"];
  for (const prefix of ["/api/maps", "/api/journal", "/api/manual-pages"]) {
    for (const id of ids) {
      const res = await request.get(`${base}${prefix}/${id}/image`);
      expect(res.status(), `${prefix}/${id}/image`).toBe(404);
      expect(res.headers()["content-type"] ?? "", `${prefix}/${id}/image`).toContain("application/json");
    }
    // A *literal* `..` segment never even reaches the route: the client and the
    // runtime collapse it, and the path it collapses to is not on the public
    // allowlist, so `src/proxy.ts` answers 401. Either way, no file is read.
    expect([401, 404]).toContain((await request.get(`${base}${prefix}/../image`)).status());
  }
});

test("HEAD works on a public image route", async ({ request }) => {
  const shelf = await (await request.get(`${base}/shelf`)).text();
  const img = shelf.match(/\/api\/img\/[^"&?]+/)?.[0];
  expect(img, "the shelf should render at least one cover").toBeTruthy();
  const head = await request.head(`${base}${img}`);
  expect(head.status()).toBe(200);
  expect(head.headers()["content-type"]).toMatch(/^image\//);
});

test("a redirect target that leaves the site is refused on the way in", async ({ request }) => {
  // "/\evil.example" starts with one slash and is not "//" — and every browser
  // resolves it to https://evil.example/. The login form must never emit it.
  for (const [next, expected] of [
    ["/\\evil.example", "/"],
    ["//evil.example", "/"],
    ["https://evil.example", "/"],
    ["/import", "/import"],
  ] as const) {
    const res = await request.post(`${base}/api/auth/login`, {
      form: { password: PASSWORD, next },
      maxRedirects: 0,
    });
    expect(res.status(), next).toBe(303);
    expect(res.headers()["location"], next).toBe(expected);
  }
});

test("nothing here is indexable", async ({ request }) => {
  for (const p of ["/", "/shelf", "/api/tags"]) {
    const res = await request.get(`${base}${p}`);
    expect(res.headers()["x-robots-tag"], p).toContain("noindex");
  }
  const robots = await (await request.get(`${base}/robots.txt`)).text();
  expect(robots).toContain("Disallow: /");
});
