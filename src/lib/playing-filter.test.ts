import { describe, expect, it } from "vitest";
import type { InProgressRow, QueuedRow, ShelfGame } from "./collection";
import { activeFilterCount, facets, parseFilters, splitInOrder } from "./filters";

/**
 * `/playing` filtering (GAMEEXPLOR-0015). The page hands the shelf's own
 * `verdictFor` a `ShelfGame` per **owned copy**, so what is worth testing here
 * is the part that is not the shelf's: that a filter only ever removes rows
 * and never reorders them. Run recency and the queue's curated `position` are
 * the content of these two lists, and a filter that quietly re-sorted them
 * would be a bug you would only notice by reading the queue wrong.
 *
 * DB-free fixtures, same shape as filters.test.ts.
 */
function game(over: Partial<ShelfGame> & { title: string }): ShelfGame {
  const platform = over.platform ?? "nes";
  const platformLabel = over.platformLabel ?? "NES";
  const id = over.id ?? over.title.toLowerCase();
  return {
    id,
    name: over.title,
    platform,
    platformLabel,
    copies: over.copies ?? [{ ownedId: id, platform, platformLabel, quantity: 1 }],
    quantity: 1,
    igdbId: null,
    cover: "c",
    year: 1988,
    genres: [],
    themes: [],
    perspectives: [],
    rating: null,
    playtime: null,
    players: { label: "", tier: "unknown", max: null, coop: null, multiplayer: null, single: null, simultaneous: null, verified: false },
    hasScreenshots: false,
    tags: [],
    similar: [],
    summary: null,
    play: { status: "never", runs: 0, lastPlayedAt: null },
    ...over,
    // Tags follow the genres so a fixture only has to name the genre once.
    ...(over.tags ? {} : { tags: [...(over.genres ?? [])].map((t) => ({ tag: t, key: t.toLowerCase(), source: "igdb" as const })) }),
  };
}

const contra = game({ title: "Contra", genres: ["Shooter"], players: { label: "", tier: "exact", max: 2, coop: true, multiplayer: true, single: true, simultaneous: true, verified: false } });
const zelda = game({ title: "Zelda", genres: ["Adventure"], players: { label: "", tier: "mode", max: 1, coop: false, multiplayer: false, single: true, simultaneous: false, verified: false } });
const chrono = game({ title: "Chrono Trigger", platform: "snes", platformLabel: "SNES", genres: ["Adventure"], players: { label: "", tier: "mode", max: 1, coop: false, multiplayer: false, single: true, simultaneous: false, verified: false } });
const mystery = game({ title: "Mystery", platform: "snes", platformLabel: "SNES", year: null });
const tecmo = game({ title: "Tecmo Bowl", genres: ["Sport"], players: { label: "", tier: "mode", max: null, coop: false, multiplayer: true, single: true, simultaneous: null, verified: false } });

/** Open runs come back most-recent-first; the fixture order IS that order. */
const inProgress: InProgressRow[] = [contra, chrono].map((g, i) => ({
  ownedGameId: g.id,
  name: g.name,
  cover: g.cover,
  platformLabel: g.platformLabel,
  game: g,
  sessionId: `s${i}`,
  startedAt: new Date(`2026-08-${20 - i}T12:00:00.000Z`),
  note: null,
  lastEntry: null,
}));

/** The queue in its curated order — deliberately not alphabetical. */
const upNext: QueuedRow[] = [zelda, mystery, tecmo].map((g, i) => ({
  ownedGameId: g.id,
  name: g.name,
  cover: g.cover,
  platformLabel: g.platformLabel,
  game: g,
  position: i,
  note: null,
}));

const names = (rows: { name: string }[]) => rows.map((r) => r.name);
const f = (qs: string) => parseFilters(new URLSearchParams(qs));

describe("splitInOrder on the /playing lists", () => {
  it("passes everything through untouched with no filter", () => {
    const open = splitInOrder(inProgress, f(""));
    const queue = splitInOrder(upNext, f(""));
    expect(names(open.confirmed)).toEqual(["Contra", "Chrono Trigger"]);
    expect(names(queue.confirmed)).toEqual(["Zelda", "Mystery", "Tecmo Bowl"]);
    expect(open.maybe).toEqual([]);
    expect(queue.maybe).toEqual([]);
    expect(open.excluded + queue.excluded).toBe(0);
  });

  it("a platform filter narrows both lists", () => {
    const open = splitInOrder(inProgress, f("platform=nes"));
    const queue = splitInOrder(upNext, f("platform=nes"));
    expect(names(open.confirmed)).toEqual(["Contra"]);
    expect(open.excluded).toBe(1);
    expect(names(queue.confirmed)).toEqual(["Zelda", "Tecmo Bowl"]);
    expect(queue.excluded).toBe(1);
    // The section heading reads "2 of 3" from exactly these numbers.
    expect(queue.confirmed.length + queue.maybe.length).toBe(2);
    expect(upNext.length).toBe(3);
  });

  it("a tag filter narrows both lists", () => {
    const open = splitInOrder(inProgress, f("tags=Adventure"));
    const queue = splitInOrder(upNext, f("tags=Adventure"));
    expect(names(open.confirmed)).toEqual(["Chrono Trigger"]);
    expect(names(queue.confirmed)).toEqual(["Zelda"]);
    // A genre chip is the same filter arriving as `genre=`.
    expect(names(splitInOrder(upNext, f("genre=Sport")).confirmed)).toEqual(["Tecmo Bowl"]);
  });

  it("keeps rows with no data either way, separately, unless strict", () => {
    // Mystery has no year: an era filter cannot rule it out, only fail to confirm it.
    const loose = splitInOrder(upNext, f("era=80s"));
    expect(names(loose.confirmed)).toEqual(["Zelda", "Tecmo Bowl"]);
    expect(names(loose.maybe)).toEqual(["Mystery"]);
    expect(loose.excluded).toBe(0);
    const strict = splitInOrder(upNext, f("era=80s&strict=1"));
    expect(names(strict.confirmed)).toEqual(["Zelda", "Tecmo Bowl"]);
    expect(strict.maybe).toEqual([]);
    expect(strict.excluded).toBe(1);
  });

  it("never reorders — a filter only removes", () => {
    // Alphabetically this queue is Mystery, Tecmo Bowl, Zelda; the curated
    // order is the opposite way round, and filtering must not touch it.
    const queue = splitInOrder(upNext, f("players=1"));
    expect(names(queue.confirmed)).toEqual(["Zelda", "Tecmo Bowl"]);
    expect(names(queue.maybe)).toEqual(["Mystery"]);
    // Positions stay the ones the queue was loaded with — the confirmed rows
    // keep 0 and 2 rather than being renumbered into a new list.
    expect(queue.confirmed.map((r) => r.position)).toEqual([0, 2]);
    expect(queue.maybe.map((r) => r.position)).toEqual([1]);
    // And the in-progress list stays newest-first, not A–Z.
    const open = splitInOrder(inProgress, f("players=1"));
    expect(names(open.confirmed)).toEqual(["Contra", "Chrono Trigger"]);
    expect(open.confirmed[0].startedAt.getTime()).toBeGreaterThan(open.confirmed[1].startedAt.getTime());
  });

  it("renders the queue in its curated order, dimmed rows included", () => {
    // The bug this pins: splitting into confirmed and maybe and then drawing
    // one group after the other re-sorts the list as surely as sortGames
    // would. On the queue the order IS the plan, so a "could work" game at
    // position 1 drawn after a confirmed one at position 2 tells you the wrong
    // game is next — and the page offers a "Play now" button on every row.
    const queue = splitInOrder(upNext, f("players=1"));
    expect(names(queue.kept)).toEqual(["Zelda", "Mystery", "Tecmo Bowl"]);
    expect(queue.kept.map((r) => r.position)).toEqual([0, 1, 2]);
    // `kept` is exactly the two groups, so nothing is drawn twice or dropped.
    expect(queue.kept.length).toBe(queue.confirmed.length + queue.maybe.length);
    const open = splitInOrder(inProgress, f("players=1"));
    expect(names(open.kept)).toEqual(names(inProgress.filter((r) => open.kept.includes(r))));
  });

  it("only removes rows when a filter is actually on — what the queue's reorder lock rests on", () => {
    // `QueueList` disables reordering on `activeFilterCount(f) > 0`, because
    // PATCH /api/queue takes a full permutation and a filtered list is not
    // one. That guard is only sound while nothing can drop a row without
    // `activeFilterCount` noticing — `strict`, `view`, `sort` and `seed` are
    // not counted, so none of them may narrow anything on its own. Adding a
    // field to `verdictFor` without adding it to `activeFilterCount` turns a
    // green suite into a corrupted queue; this is the test that goes red.
    for (const qs of ["", "strict=1", "view=list", "sort=year", "seed=42", "strict=1&view=list&sort=shuffle&seed=7"]) {
      const filters = f(qs);
      expect(activeFilterCount(filters)).toBe(0);
      // Widened to the constraint `splitInOrder` actually takes: a union of two
      // row arrays does not infer a single `T`.
      const lists: readonly { game: ShelfGame }[][] = [inProgress, upNext];
      for (const rows of lists) {
        const split = splitInOrder(rows, filters);
        expect(split.kept).toEqual([...rows]);
        expect(split.maybe).toEqual([]);
        expect(split.excluded).toBe(0);
      }
    }
  });

  it("a search matches across both lists the way the shelf's does", () => {
    expect(names(splitInOrder(inProgress, f("q=contra")).confirmed)).toEqual(["Contra"]);
    expect(names(splitInOrder(upNext, f("q=contra")).confirmed)).toEqual([]);
    expect(splitInOrder(upNext, f("q=contra")).excluded).toBe(3);
  });

  it("facets are built over both lists, so the sheet offers only what is on the page", () => {
    const both = facets([...inProgress, ...upNext].map((r) => r.game));
    expect(both.platforms.map((p) => p.slug).sort()).toEqual(["nes", "snes"]);
    expect(both.platforms.find((p) => p.slug === "nes")?.count).toBe(3);
    expect(both.platforms.find((p) => p.slug === "snes")?.count).toBe(2);
    expect(both.genres.map((g) => g.name)).toEqual(["Adventure", "Shooter", "Sport"]);
    expect(both.genres.find((g) => g.name === "Adventure")?.count).toBe(2);
  });
});
