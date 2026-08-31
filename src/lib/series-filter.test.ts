import { describe, expect, it } from "vitest";
import type { ShelfGame } from "./collection";
import type { SeriesEntryView } from "./series/service";
import { facets, parseFilters, splitInOrder } from "./filters";
import { groupBySection } from "./series/shape";

/**
 * The series page's filtering (GAMEEXPLOR-0016). Every entry carries a
 * `ShelfGame` — the real one for a copy on the shelf, a synthesised one for a
 * game nobody owns — so the shelf's `verdictFor` is what decides, and there is
 * nothing series-specific to test about *that*.
 *
 * What is specific, and what this file pins, is the shape around it: the
 * curated order survives, a section that filters down to nothing disappears
 * rather than leaving a bare heading, an unowned entry filters on what IGDB
 * says it was released on, and its sparse data lands it in "could work"
 * instead of being ruled out.
 *
 * DB-free fixtures, same shape as playing-filter.test.ts.
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

/** What the grid actually renders: the base entry plus the game it filters on. */
type Entry = Pick<SeriesEntryView, "id" | "section" | "ownedId" | "game">;

const owned = (g: ShelfGame, section: string | null = null): Entry => ({ id: g.id, section, ownedId: g.id, game: g });

/**
 * An entry nobody owns, the way `catalogShelfGame` builds it: copies from the
 * catalog's platform list with an empty `ownedId` and a quantity of 0, and
 * whatever IGDB knows — which for an unowned game is usually not much.
 */
const missing = (g: ShelfGame, platforms: string[], section: string | null = null): Entry => ({
  id: g.id,
  section,
  ownedId: null,
  game: { ...g, quantity: 0, copies: platforms.map((platform) => ({ ownedId: "", platform, platformLabel: platform.toUpperCase(), quantity: 0 })) },
});

// One series in curated order: two you own, two you do not, in the order a
// person put them in rather than alphabetically or owned-first.
const one = owned(game({ title: "Contra", genres: ["Shooter"], players: { label: "", tier: "exact", max: 2, coop: true, multiplayer: true, single: true, simultaneous: true, verified: false } }), "Mainline");
const two = missing(game({ title: "Super C", genres: ["Shooter"], year: 1990 }), ["nes", "snes"], "Mainline");
const three = owned(game({ title: "Contra III", platform: "snes", platformLabel: "SNES", genres: ["Shooter"], year: 1992, play: { status: "playing", runs: 1, lastPlayedAt: null } }), "Mainline");
const four = missing(game({ title: "Probotector", genres: ["Platform"], year: 1994 }), ["genesis"], "Spin-offs");

const entries: Entry[] = [one, two, three, four];
const names = (rows: Entry[]) => rows.map((r) => r.game.name);
const f = (qs: string) => parseFilters(new URLSearchParams(qs));

/** What the component does: split each section, then drop the ones left empty. */
const sections = (filterString: string) =>
  groupBySection(entries)
    .map((g) => ({ section: g.section, ...splitInOrder(g.entries, f(filterString)) }))
    .filter((g) => g.kept.length);

describe("filtering a series", () => {
  it("shows a game whose platforms we cannot resolve, rather than ruling it out", () => {
    // IGDB spells platforms in ways this app has no slug for — "Arcade",
    // "Sharp X68000" — and `catalogShelfGame` then leaves `copies` empty. That
    // is missing data, not a game released on nothing, so a platform filter
    // has to treat it the way every other filter treats a gap: show it,
    // separately, in the "could work" group. Ruling it out would hide the
    // arcade original from `/series/donkey-kong?missing=1&platform=nes` —
    // exactly the gap the missing view exists to show.
    const arcade = missing(game({ title: "Donkey Kong", year: 1981 }), []);
    const split = splitInOrder([one, arcade], f("platform=nes"));
    expect(names(split.confirmed)).toEqual(["Contra"]);
    expect(names(split.maybe)).toEqual(["Donkey Kong"]);
    expect(split.excluded).toBe(0);
    // `strict` is still the way to ask for only what is confirmed.
    expect(names(splitInOrder([one, arcade], f("platform=nes&strict=1")).kept)).toEqual(["Contra"]);
  });

  it("shows every entry, in curated order, with no filter", () => {
    expect(sections("").map((g) => [g.section, names(g.kept)])).toEqual([
      ["Mainline", ["Contra", "Super C", "Contra III"]],
      ["Spin-offs", ["Probotector"]],
    ]);
  });

  it("never reorders — the curated position is the content, so a filter only removes", () => {
    const [mainline] = sections("platform=nes");
    // Alphabetically this is Contra, Contra III, Super C; the series order puts
    // Super C second and that is what has to come back.
    expect(names(mainline.kept)).toEqual(["Contra", "Super C"]);
    // Owned and unowned interleave in place: nothing is swept to the end.
    expect(mainline.kept.map((e) => e.ownedId != null)).toEqual([true, false]);
  });

  it("drops a section whose entries are all filtered out rather than leaving a bare heading", () => {
    expect(sections("platform=snes").map((g) => g.section)).toEqual(["Mainline"]);
    expect(sections("tags=Platform").map((g) => [g.section, names(g.kept)])).toEqual([["Spin-offs", ["Probotector"]]]);
  });

  it("filters an unowned entry on what it was released on: the platform filter reads 'owned on, or released on'", () => {
    // Super C is on the NES and the SNES and you own neither; Probotector is on
    // the Genesis, which nothing on this page is.
    expect(names(sections("platform=snes")[0].kept)).toEqual(["Super C", "Contra III"]);
    expect(sections("platform=genesis").map((g) => names(g.kept))).toEqual([["Probotector"]]);
  });

  it("leaves an unowned entry as 'could work' when IGDB knows nothing, instead of ruling it out", () => {
    // Two of us: Contra is confirmed, the unowned entries have no player data
    // at all, and the three-valued rule says that is unknown and not a no.
    const [mainline] = sections("players=2");
    expect(names(mainline.confirmed)).toEqual(["Contra"]);
    expect(names(mainline.maybe)).toEqual(["Super C", "Contra III"]);
    expect(mainline.excluded).toBe(0);
    // …and strict is what says "only what you can prove".
    const strict = sections("players=2&strict=1");
    expect(strict.map((g) => names(g.kept))).toEqual([["Contra"]]);
  });

  it("keeps the shelf's other filters working on the entries you do own", () => {
    expect(sections("play=playing").map((g) => names(g.kept))).toEqual([["Contra III"]]);
    expect(sections("era=90s").map((g) => names(g.kept))).toEqual([["Super C", "Contra III"], ["Probotector"]]);
    expect(sections("q=probo").map((g) => names(g.kept))).toEqual([["Probotector"]]);
  });

  it("builds facets over the whole page, unowned entries included", () => {
    const all = facets(entries.map((e) => e.game));
    expect(all.platforms.map((p) => p.slug).sort()).toEqual(["genesis", "nes", "snes"]);
    // NES: the Contra cartridge you own plus the Super C you do not.
    expect(all.platforms.find((p) => p.slug === "nes")?.count).toBe(2);
    expect(all.genres.map((g) => g.name)).toEqual(["Shooter", "Platform"]);
    expect(all.genres.find((g) => g.name === "Shooter")?.count).toBe(3);
  });
});
