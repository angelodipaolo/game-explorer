import { describe, expect, it } from "vitest";
import type { ShelfGame } from "./collection";
import { applyFilters, parseFilters } from "./filters";
import { MAX_CONTAINMENT, MAX_OVERLAP, MAX_ROWS_PER_GAME, MAX_ROW_SHARE, MIN_ROW, buildHomeRows, candidateRows, nearIdentical, platformPhrase } from "./home";

/**
 * A realistic-shaped shelf: several platforms of very different sizes, tags
 * that overlap, a long tail of thin combinations, sparse player data, a decade
 * spread and some games never played. Generated deterministically so the
 * fixed-date assertions below mean what they say.
 */
const PLATFORMS: [string, string, number][] = [
  ["nes", "NES", 60],
  ["snes", "SNES", 40],
  ["ps2", "PS2", 30],
  ["switch", "Switch", 25],
  ["gb", "GB", 12],
  ["3do", "3DO", 3],
];
const GENRES = ["Puzzle", "Platform", "Shooter", "Adventure", "Sport", "Role-playing (RPG)"];
const THEMES = ["Action", "Fantasy", "Party"];

function shelf(): ShelfGame[] {
  const games: ShelfGame[] = [];
  let n = 0;
  for (const [platform, platformLabel, count] of PLATFORMS) {
    for (let i = 0; i < count; i++) {
      n++;
      const genre = GENRES[n % GENRES.length];
      const theme = THEMES[n % THEMES.length];
      const id = `${platform}-${i}`;
      const tags = [genre, theme].map((t) => ({ tag: t, key: t.toLowerCase(), source: "igdb" as const }));
      games.push({
        id,
        title: `Game ${n}`,
        name: `Game ${n}`,
        platform,
        platformLabel,
        copies: [{ ownedId: id, platform, platformLabel, quantity: 1 }],
        quantity: 1,
        igdbId: n,
        cover: n % 17 === 0 ? null : `cover-${n}`,
        year: 1984 + (n % 34),
        genres: [genre],
        themes: [theme],
        perspectives: n % 2 === 0 ? ["Side view"] : ["Third person"],
        rating: 50 + (n % 40),
        playtime: n % 3 === 0 ? null : 30 + (n % 10) * 40,
        players: {
          label: "",
          tier: n % 5 === 0 ? "unknown" : "exact",
          max: n % 5 === 0 ? null : (n % 4) + 1,
          coop: n % 5 === 0 ? null : n % 3 === 0,
          multiplayer: n % 5 === 0 ? null : n % 4 !== 0,
          single: true,
          simultaneous: n % 5 === 0 ? null : n % 2 === 0,
          verified: false,
        },
        hasScreenshots: false,
        tags,
        similar: [],
        summary: null,
        play: { status: n % 4 === 0 ? "played" : "never", runs: n % 4 === 0 ? 1 : 0, lastPlayedAt: null },
      });
    }
  }
  return games;
}

const all = shelf();
const series = [{ name: "Mario Party", slug: "mario-party", ownedIds: all.slice(0, 11).map((g) => g.id) }];
const DAY = new Date(2026, 7, 30);
const OTHER_DAY = new Date(2026, 7, 31);
const signature = (rows: { key: string; title: string; games: { id: string }[] }[]) => rows.map((r) => `${r.key}|${r.title}|${r.games.map((g) => g.id).join(",")}`).join("\n");

describe("home rows", () => {
  const rows = buildHomeRows(all, { date: DAY, series });

  it("draws a fixed number of rows from a much larger pool", () => {
    expect(candidateRows(all, series, MIN_ROW).length).toBeGreaterThan(40);
    expect(rows).toHaveLength(8);
    expect(new Set(rows.map((r) => r.key)).size).toBe(8);
  });

  it("is identical for the same date and different for another — like tonight's picks", () => {
    expect(signature(buildHomeRows(all, { date: DAY, series }))).toBe(signature(rows));
    expect(signature(buildHomeRows(all, { date: new Date(2026, 7, 30, 23, 59), series }))).toBe(signature(rows));
    expect(signature(buildHomeRows(all, { date: OTHER_DAY, series }))).not.toBe(signature(rows));
  });

  it("rejects thin combinations", () => {
    for (const r of rows) expect(r.games.length).toBeGreaterThanOrEqual(MIN_ROW);
    // The 3DO shelf is three games, so no combination involving it is ever
    // offered — not as a platform row and not crossed with a tag.
    const pool = candidateRows(all, series, MIN_ROW);
    expect(pool.some((c) => c.kind === "tag-platform" && c.key.includes("3do"))).toBe(false);
    expect(rows.some((r) => r.href.includes("platform=3do"))).toBe(false);
  });

  it("shows no game in more than the allowed number of rows", () => {
    const seen = new Map<string, number>();
    for (const r of rows) for (const g of r.games) seen.set(g.id, (seen.get(g.id) ?? 0) + 1);
    expect(Math.max(...seen.values())).toBeLessThanOrEqual(MAX_ROWS_PER_GAME);
  });

  it("never puts two near-identical rows on the page", () => {
    const sets = rows.map((r) => new Set(applyFilters(all, parseFilters(new URLSearchParams(r.href.split("?")[1] ?? ""))).confirmed.map((g) => g.id)));
    for (let i = 0; i < sets.length; i++) {
      for (let j = i + 1; j < sets.length; j++) {
        if (rows[i].kind === "series" || rows[j].kind === "series") continue;
        const shared = [...sets[i]].filter((id) => sets[j].has(id)).length;
        expect(shared / (sets[i].size + sets[j].size - shared)).toBeLessThanOrEqual(MAX_OVERLAP);
        // And neither row may be swallowed by the other: a strict subset scores
        // low on Jaccard while showing nothing the bigger row does not.
        expect(shared / Math.min(sets[i].size, sets[j].size)).toBeLessThanOrEqual(MAX_CONTAINMENT);
      }
    }
  });

  it("counts a strict subset as the same row twice, even when Jaccard is low", () => {
    const big = new Set(Array.from({ length: 100 }, (_, i) => `g${i}`));
    // "Arcade games on the NES" inside "Everything on the NES": Jaccard 0.3,
    // containment 1.0. Jaccard alone would have let this through.
    const inside = new Set(Array.from({ length: 30 }, (_, i) => `g${i}`));
    expect(nearIdentical(inside, big, MAX_OVERLAP)).toBe(true);
    expect(nearIdentical(big, inside, MAX_OVERLAP)).toBe(true);
    // Two rows that merely share some games are still two rows: 20 of 30 each
    // is Jaccard 0.5, containment 0.67.
    const a = new Set(Array.from({ length: 30 }, (_, i) => `g${i}`));
    const b = new Set(Array.from({ length: 30 }, (_, i) => `g${i + 10}`));
    expect(nearIdentical(a, b, MAX_OVERLAP)).toBe(false);
    expect(nearIdentical(new Set(["a"]), new Set(["b"]), MAX_OVERLAP)).toBe(false);
    expect(nearIdentical(new Set(), big, MAX_OVERLAP)).toBe(false);
  });

  it("never offers a row that is nearly the whole shelf", () => {
    for (const r of rows) expect(r.total).toBeLessThanOrEqual(all.length * MAX_ROW_SHARE);
  });

  it("does not turn an empty play log into 'You have never played these'", () => {
    // With nothing played, `play=never` matches the entire collection, so the
    // row would be the shelf under a title promising a selection.
    const unplayed = all.map((g) => ({ ...g, play: { status: "never" as const, runs: 0, lastPlayedAt: null } }));
    for (let d = 0; d < 14; d++) {
      const day = buildHomeRows(unplayed, { date: new Date(2026, 7, 20 + d), series });
      expect(day.some((r) => r.title === "You have never played these")).toBe(false);
      expect(day).toHaveLength(8);
    }
  });

  it("titles read as sentences", () => {
    for (const r of rows) {
      expect(r.title).toMatch(/^[A-Z]/);
      expect(r.title).not.toMatch(/[?&=]|tags=|platform=/);
    }
    expect(platformPhrase("nes")).toBe("the NES");
    expect(platformPhrase("switch")).toBe("Switch");
    // One template per row kind, over the whole pool a row is drawn from.
    const titles = candidateRows(all, series, MIN_ROW).map((c) => c.title);
    expect(titles).toContain("Puzzle games on the NES");
    expect(titles).toContain("More Puzzle games");
    expect(titles).toContain("Everything on the SNES");
    expect(titles).toContain("Your 90s shelf");
    expect(titles).toContain("Co-op games for two");
    expect(titles).toContain("You have never played these");
    expect(titles).toContain("Every Mario Party");
    // IGDB's database spelling is re-worded for the sentence, but the filter
    // value stays the tag the collection carries.
    expect(titles).toContain("RPG games on the NES");
  });
});

/**
 * The whole point of a row header: it is a filter, so following it must return
 * the games the row showed. Checked end to end — the row's href is parsed back
 * into `Filters` and run through `applyFilters`, the same call the shelf makes.
 */
describe("row headers and the shelf agree", () => {
  it("every filter row resolves to a shelf view containing exactly its games", () => {
    for (const row of buildHomeRows(all, { date: DAY, series, rows: 40 })) {
      if (row.kind === "series") {
        expect(row.href).toBe("/series/mario-party");
        continue;
      }
      expect(row.href.startsWith("/shelf")).toBe(true);
      const result = applyFilters(all, parseFilters(new URLSearchParams(row.href.split("?")[1] ?? "")));
      // `strict` is set on three-valued rows, so what the shelf shows *is* the
      // confirmed set the row drew from — nothing lands in "could work".
      const shelfIds = new Set([...result.confirmed, ...result.maybe].map((g) => g.id));
      expect(shelfIds.size).toBe(row.total);
      for (const g of row.games) expect(shelfIds.has(g.id)).toBe(true);
    }
  });

  it("a tag x platform row opens the shelf on that tag and platform", () => {
    // Whichever day offers one — the row kind is in the pool every day, but
    // which rows are drawn is the seed's business.
    const row = [...Array(14).keys()]
      .flatMap((d) => buildHomeRows(all, { date: new Date(2026, 7, 20 + d), series }))
      .find((r) => r.kind === "tag-platform")!;
    expect(row).toBeDefined();
    expect(row.href).toMatch(/^\/shelf\?platform=[a-z0-9]+&tags=.+$/);
    const confirmed = applyFilters(all, parseFilters(new URLSearchParams(row.href.split("?")[1]))).confirmed;
    expect(confirmed.length).toBe(row.total);
    expect(row.games.every((g) => confirmed.some((c) => c.id === g.id))).toBe(true);
  });
});

describe("degrading", () => {
  it("fills the page without series or play data", () => {
    const plain = all.map((g) => ({ ...g, play: { status: "never" as const, runs: 0, lastPlayedAt: null } }));
    const rows = buildHomeRows(plain, { date: DAY });
    expect(rows).toHaveLength(8);
    expect(rows.some((r) => r.kind === "series")).toBe(false);
  });

  it("still fills a small, narrow collection with broad fallback rows", () => {
    const tiny = all.filter((g) => g.platform === "nes").slice(0, 9).map((g) => ({ ...g, tags: [], genres: [], themes: [] }));
    const rows = buildHomeRows(tiny, { date: DAY });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].games.length).toBeGreaterThanOrEqual(2);
    for (const r of rows) expect(r.href.startsWith("/shelf")).toBe(true);
  });

  it("a dozen games across three small platforms still gets rows, not one", () => {
    const twelve = [...all.filter((g) => g.platform === "nes").slice(0, 4), ...all.filter((g) => g.platform === "snes").slice(0, 4), ...all.filter((g) => g.platform === "gb").slice(0, 4)];
    const rows = buildHomeRows(twelve, { date: DAY });
    expect(rows.length).toBeGreaterThanOrEqual(3);
    // Broad and deterministic: the platforms, biggest first, whatever the day.
    expect(rows.map((r) => r.title)).toEqual(buildHomeRows(twelve, { date: OTHER_DAY }).map((r) => r.title));
    for (const r of rows) expect(r.games.length).toBeGreaterThanOrEqual(2);
  });

  it("has nothing to say about an empty shelf", () => {
    expect(buildHomeRows([], { date: DAY })).toEqual([]);
  });
});
