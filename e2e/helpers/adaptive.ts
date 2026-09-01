import { expect, type Locator, type Page } from "@playwright/test";

/**
 * The adaptive assertions (GAMEEXPLOR-0023). Shared so the rules are written
 * once and the specs read as prose: overflow, modal behaviour, target size,
 * contrast.
 *
 * Everything here measures. No assertion in this file passes because a class
 * name looks right — each one reads a real bounding box, a real computed
 * colour, or a real hit test in the browser.
 */

/** The mobile touch-target standard this app holds itself to, in CSS pixels. */
export const TARGET = 44;

/** WCAG AA for normal-size text. */
export const AA = 4.5;

/**
 * The page does not scroll sideways. A 1px tolerance covers sub-pixel layout
 * rounding at fractional device scale factors; anything more is a real burst
 * row, and the message names the elements sticking out so it can be found.
 */
export async function expectNoHorizontalOverflow(page: Page, where: string): Promise<void> {
  const report = await page.evaluate(() => {
    const doc = document.documentElement;
    const overflow = doc.scrollWidth - doc.clientWidth;
    const culprits: string[] = [];
    if (overflow > 1) {
      for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.right <= doc.clientWidth + 1) continue;
        const cls = typeof el.className === "string" ? el.className.split(/\s+/).slice(0, 3).join(".") : "";
        culprits.push(`${el.tagName.toLowerCase()}${cls ? "." + cls : ""}@${Math.round(r.right)}`);
        if (culprits.length >= 5) break;
      }
    }
    return { overflow, culprits, width: doc.clientWidth };
  });
  expect(report.overflow, `${where} at ${report.width}px: horizontal overflow — ${report.culprits.join(" | ") || "no element identified"}`).toBeLessThanOrEqual(1);
}

/** The control's own box is at least 44×44 — it grew, rather than borrowing space. */
export async function expectTapTarget(locator: Locator, name: string, min = TARGET): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  expect(box, `${name}: no box (not visible?)`).not.toBeNull();
  expect(box!.width, `${name}: width ${box!.width.toFixed(1)}`).toBeGreaterThanOrEqual(min - 0.5);
  expect(box!.height, `${name}: height ${box!.height.toFixed(1)}`).toBeGreaterThanOrEqual(min - 0.5);
}

/**
 * The control *receives a tap* anywhere in a 44×44 square centred on it, even
 * though its ink may be smaller (the `.tap-44` pseudo-element in
 * `globals.css`). This is the deliberate equivalent-hit-area route, and it is
 * verified the only honest way: four hit tests at the edges of the square,
 * through `document.elementFromPoint`, which is the same thing the browser
 * does with a finger. A neighbour that has crept into the square shows up as
 * the element that answered instead.
 */
export async function expectHitArea(locator: Locator, name: string, min = TARGET): Promise<void> {
  await locator.scrollIntoViewIfNeeded();
  const el = await locator.elementHandle();
  expect(el, `${name}: not in the DOM`).not.toBeNull();
  const probes = await locator.page().evaluate(
    ({ node, size }) => {
      const r = (node as HTMLElement).getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const half = size / 2 - 1;
      const points: [string, number, number][] = [
        ["top", cx, cy - half],
        ["bottom", cx, cy + half],
        ["left", cx - half, cy],
        ["right", cx + half, cy],
      ];
      return points.map(([side, x, y]) => {
        const hit = document.elementFromPoint(x, y);
        const ok = !!hit && (hit === node || (node as HTMLElement).contains(hit));
        const cls = hit && typeof hit.className === "string" ? hit.className.split(/\s+/)[0] : "";
        return { side, ok, got: hit ? `${hit.tagName.toLowerCase()}${cls ? "." + cls : ""}` : "nothing" };
      });
    },
    { node: el!, size: min },
  );
  for (const p of probes) expect(p.ok, `${name}: the ${p.side} edge of its ${min}px square hits ${p.got}`).toBe(true);
}

/** The `data-testid` of the focused element (or the nearest ancestor that has one). */
export async function focusedTestId(page: Page): Promise<string | null> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return null;
    return el.closest("[data-testid]")?.getAttribute("data-testid") ?? el.tagName.toLowerCase();
  });
}

async function focusIsInside(page: Page, overlay: string): Promise<boolean> {
  return page.evaluate((id) => {
    const o = document.querySelector(`[data-testid="${id}"]`);
    return !!o && !!document.activeElement && o.contains(document.activeElement);
  }, overlay);
}

export type ModalCheck = {
  /** What to call it in a failure message. */
  name: string;
  /** `data-testid` on the overlay's outermost element. */
  overlay: string;
  /** `data-testid` of the control that opens it — where focus must land again. */
  trigger: string;
  open: () => Promise<void>;
  /** How to dismiss it. Escape by default. */
  close?: () => Promise<void>;
  /** Something in the page behind, whose position must not move when the scroll locks. */
  reference?: Locator;
  /** How far to walk the trap. Enough to wrap round the overlay at least once. */
  tabs?: number;
};

/**
 * The whole modal contract in one assertion: focus moves in, Tab and
 * Shift+Tab stay in, the page behind is inert and cannot scroll, locking it
 * does not shift the layout, and closing puts focus back on the trigger.
 */
export async function expectModal(page: Page, check: ModalCheck): Promise<void> {
  const { name, overlay, trigger, open, tabs = 14 } = check;
  const before = check.reference ? await check.reference.boundingBox() : null;

  await open();
  const dialog = page.getByTestId(overlay);
  await expect(dialog, `${name}: did not open`).toBeVisible();

  expect(await focusIsInside(page, overlay), `${name}: focus did not move into the overlay`).toBe(true);

  for (let i = 0; i < tabs; i++) {
    await page.keyboard.press("Tab");
    expect(await focusIsInside(page, overlay), `${name}: Tab ${i + 1} escaped the overlay to ${await focusedTestId(page)}`).toBe(true);
  }
  for (let i = 0; i < 5; i++) {
    await page.keyboard.press("Shift+Tab");
    expect(await focusIsInside(page, overlay), `${name}: Shift+Tab ${i + 1} escaped the overlay to ${await focusedTestId(page)}`).toBe(true);
  }

  const background = await page.evaluate((id) => {
    const o = document.querySelector(`[data-testid="${id}"]`);
    const siblings = Array.from(document.body.children).filter((el) => el !== o && !el.contains(o));
    return {
      overflow: getComputedStyle(document.body).overflow,
      inert: siblings.length > 0 && siblings.every((el) => el.hasAttribute("inert")),
      siblings: siblings.length,
    };
  }, overlay);
  expect(background.overflow, `${name}: the page behind still scrolls`).toBe("hidden");
  expect(background.inert, `${name}: the page behind is not inert (${background.siblings} siblings)`).toBe(true);

  if (check.reference && before) {
    const during = await check.reference.boundingBox();
    expect(during, `${name}: the reference element vanished`).not.toBeNull();
    // The scroll lock compensates for the scrollbar it removes; without that,
    // opening a menu jogs the whole page sideways on a desktop.
    expect(Math.abs(during!.x - before.x), `${name}: locking the scroll shifted the layout by ${(during!.x - before.x).toFixed(1)}px`).toBeLessThanOrEqual(1);
  }

  if (check.close) await check.close();
  else await page.keyboard.press("Escape");
  await expect(dialog, `${name}: did not close`).toBeHidden();

  expect(await focusedTestId(page), `${name}: focus did not return to the trigger`).toBe(trigger);
  const after = await page.evaluate(() => ({ overflow: document.body.style.overflow, padding: document.body.style.paddingRight, inert: Array.from(document.body.children).filter((el) => el.hasAttribute("inert")).length }));
  expect(after.overflow, `${name}: the scroll lock was not released`).toBe("");
  expect(after.padding, `${name}: the scrollbar compensation was not released`).toBe("");
  expect(after.inert, `${name}: the page behind is still inert`).toBe(0);
}

/**
 * `--faint` (and the other text tokens) clear AA on every ground they are
 * printed on, measured off the live document rather than off the source: this
 * is what the browser actually resolved.
 */
export async function expectTokenContrast(page: Page, minimum = AA): Promise<void> {
  const rows = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    const read = (name: string) => cs.getPropertyValue(name).trim();
    const channels = (hex: string) => {
      const h = hex.replace("#", "");
      const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
      return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
    };
    const lum = (hex: string) => {
      const [r, g, b] = channels(hex).map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const ratio = (a: string, b: string) => {
      const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
      return (hi + 0.05) / (lo + 0.05);
    };
    const out: { fg: string; bg: string; ratio: number }[] = [];
    for (const fg of ["--faint", "--muted", "--text", "--nes-grey"]) {
      for (const bg of ["--bg", "--bg-elev", "--surface", "--surface-2"]) {
        out.push({ fg, bg, ratio: ratio(read(fg), read(bg)) });
      }
    }
    return out;
  });
  expect(rows.length).toBeGreaterThan(0);
  for (const r of rows) expect(r.ratio, `${r.fg} on ${r.bg} is ${r.ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(minimum);
}

/** What a `.text-faint` element actually renders as, so the token is not merely declared but used. */
export async function expectRenderedFaint(page: Page, locator: Locator, name: string, minimum = AA): Promise<void> {
  await expect(locator, `${name}: not on the page`).toBeVisible();
  const measured = await locator.evaluate((el) => {
    const rgb = (v: string) => (v.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
    const lum = (c: number[]) => {
      const [r, g, b] = c.map((x) => x / 255).map((x) => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)));
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    // Walk up for the first ancestor that actually paints a background.
    let ground: Element | null = el;
    let bg = [10, 10, 10];
    while (ground) {
      const c = getComputedStyle(ground).backgroundColor;
      const parts = rgb(c);
      const alpha = Number((c.match(/[\d.]+/g) ?? [])[3] ?? 1);
      if (parts.length === 3 && alpha > 0.5) {
        bg = parts;
        break;
      }
      ground = ground.parentElement;
    }
    const fg = rgb(getComputedStyle(el).color);
    const [hi, lo] = [lum(fg), lum(bg)].sort((a, b) => b - a);
    return { ratio: (hi + 0.05) / (lo + 0.05), size: parseFloat(getComputedStyle(el).fontSize) };
  });
  expect(measured.ratio, `${name}: rendered ${measured.ratio.toFixed(2)}:1 at ${measured.size}px`).toBeGreaterThanOrEqual(minimum);
}
