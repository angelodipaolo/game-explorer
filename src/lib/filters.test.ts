import { describe, expect, it } from "vitest";
import type { ShelfGame } from "./collection";
import { applyFilters, facets, parseFilters, playVerdict, seededShuffle, serializeFilters, tonightsPicks, verdictFor } from "./filters";

function game(over: Partial<ShelfGame> & { title: string }): ShelfGame {
  return {
    id: over.title.toLowerCase(),
    name: over.title,
    platform: over.platform ?? "nes",
    platformLabel: over.platformLabel ?? "NES",
    copies: over.copies ?? [{ ownedId: over.title.toLowerCase(), platform: over.platform ?? "nes", platformLabel: over.platformLabel ?? "NES", quantity: 1 }],
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
  };
}

function withTags(g: ShelfGame): ShelfGame {
  return { ...g, tags: [...g.genres, ...g.perspectives, ...g.themes].map((t) => ({ tag: t, key: t.toLowerCase(), source: "igdb" as const })) };
}

const contra = withTags(game({ title: "Contra", players: { label: "", tier: "exact", max: 2, coop: true, multiplayer: true, single: true, simultaneous: true, verified: false }, genres: ["Shooter"] }));
const zelda = withTags(game({ title: "Zelda", players: { label: "", tier: "mode", max: 1, coop: false, multiplayer: false, single: true, simultaneous: false, verified: false }, genres: ["Adventure"], playtime: 600 }));
const mystery = game({ title: "Mystery", year: null });
const tecmo = withTags(game({ title: "Tecmo Bowl", players: { label: "", tier: "mode", max: null, coop: false, multiplayer: true, single: true, simultaneous: null, verified: false }, genres: ["Sport"], platform: "snes", platformLabel: "SNES" }));
const all = [contra, zelda, mystery, tecmo];

const played = (over: Partial<ShelfGame["play"]>) => ({ status: "never" as const, runs: 0, lastPlayedAt: null, ...over });

describe("parse/serialize", () => {
  it("round-trips through the URL and drops defaults", () => {
    const f = parseFilters(new URLSearchParams("platform=nes&players=2&mode=coop&view=list&sort=shuffle&seed=7&strict=1&q=con"));
    expect(f).toMatchObject({ platforms: ["nes"], players: 2, mode: "coop", view: "list", sort: "shuffle", seed: 7, strict: true, q: "con" });
    expect(serializeFilters(f)).toBe("?q=con&platform=nes&players=2&mode=coop&strict=1&view=list&sort=shuffle&seed=7");
    expect(serializeFilters(parseFilters({}))).toBe("");
  });
  it("accepts several platforms, comma-separated, deduped", () => {
    const f = parseFilters(new URLSearchParams("platform=nes,SNES,nes"));
    expect(f.platforms).toEqual(["nes", "snes"]);
    expect(serializeFilters(f)).toBe("?platform=nes,snes");
    expect(verdictFor(contra, f)).toBe("yes");
    expect(verdictFor(tecmo, f)).toBe("yes");
    expect(verdictFor(contra, parseFilters(new URLSearchParams("platform=snes")))).toBe("no");
  });
  it("round-trips play state and drops a value it does not know", () => {
    for (const v of ["playing", "played", "never"] as const) {
      const f = parseFilters(new URLSearchParams(`play=${v}`));
      expect(f.play).toBe(v);
      expect(serializeFilters(f)).toBe(`?play=${v}`);
      // Survives the parse→serialize→parse normalisation use-filters.ts does on every write.
      expect(parseFilters(new URLSearchParams(serializeFilters(f))).play).toBe(v);
    }
    expect(parseFilters(new URLSearchParams("play=someday")).play).toBeNull();
    expect(serializeFilters(parseFilters(new URLSearchParams("play=someday")))).toBe("");
    expect(serializeFilters(parseFilters(new URLSearchParams("play=never&platform=nes")))).toBe("?platform=nes&play=never");
  });
  it("round-trips the handheld exclusion", () => {
    const f = parseFilters(new URLSearchParams("handhelds=hide"));
    expect(f.hideHandhelds).toBe(true);
    expect(serializeFilters(f)).toBe("?handhelds=hide");
  });
  it("a game on several platforms matches any of them", () => {
    const stray = game({ title: "Stray", platform: "ps4", platformLabel: "PS4", copies: [{ ownedId: "a", platform: "ps4", platformLabel: "PS4", quantity: 1 }, { ownedId: "b", platform: "ps5", platformLabel: "PS5", quantity: 1 }] });
    expect(verdictFor(stray, parseFilters(new URLSearchParams("platform=ps5")))).toBe("yes");
    expect(verdictFor(stray, parseFilters(new URLSearchParams("platform=nes")))).toBe("no");
    expect(facets([stray]).platforms.map((p) => p.slug)).toEqual(["ps4", "ps5"]);
  });
  it("ignores junk values", () => {
    expect(parseFilters(new URLSearchParams("players=99&mode=lol&view=cube"))).toMatchObject({ players: null, mode: null, view: "grid" });
  });
});

describe("verdicts", () => {
  const f = (s: string) => parseFilters(new URLSearchParams(s));
  it("two of us, co-op: confirmed / excluded / unknown", () => {
    expect(verdictFor(contra, f("players=2&mode=coop"))).toBe("yes");
    expect(verdictFor(zelda, f("players=2&mode=coop"))).toBe("no");
    expect(verdictFor(mystery, f("players=2&mode=coop"))).toBe("unknown");
    expect(verdictFor(tecmo, f("players=2&mode=coop"))).toBe("no");
  });
  it("versus treats plain multiplayer as a yes, co-op-only as unknown", () => {
    expect(verdictFor(tecmo, f("mode=versus"))).toBe("yes");
    expect(verdictFor(contra, f("mode=versus"))).toBe("unknown");
  });
  it("three players needs an exact count", () => {
    expect(verdictFor(contra, f("players=3"))).toBe("no");
    expect(verdictFor(tecmo, f("players=3"))).toBe("unknown");
  });
  it("just me", () => {
    expect(verdictFor(zelda, f("players=1"))).toBe("yes");
    expect(verdictFor(mystery, f("players=1"))).toBe("unknown");
  });
  it("length and era are unknown without data", () => {
    expect(verdictFor(zelda, f("length=long"))).toBe("yes");
    expect(verdictFor(zelda, f("length=quick"))).toBe("no");
    expect(verdictFor(contra, f("length=quick"))).toBe("unknown");
    expect(verdictFor(mystery, f("era=80s"))).toBe("unknown");
    expect(verdictFor(contra, f("era=80s"))).toBe("yes");
  });
  it("tags AND together across genres, perspectives and themes; legacy genre= still works", () => {
    const side = withTags(game({ title: "Side", genres: ["Platform"], perspectives: ["Side view"], themes: ["Fantasy"] }));
    const tagged = { ...side, tags: [...side.tags, { tag: "Metroidvania", key: "metroidvania", source: "manual" as const }] };
    expect(verdictFor(tagged, f("tags=metroidvania"))).toBe("yes");
    expect(verdictFor(side, f("tags=Metroidvania"))).toBe("no");
    expect(facets([tagged]).yours).toEqual([{ name: "Metroidvania", count: 1 }]);
    expect(verdictFor(side, f("tags=Platform,Side view"))).toBe("yes");
    expect(verdictFor(side, f("tags=Platform,Fantasy"))).toBe("yes");
    expect(verdictFor(side, f("tags=Platform,Top-down"))).toBe("no");
    expect(verdictFor(side, f("genre=Platform"))).toBe("yes");
    expect(serializeFilters(f("genre=Platform&tags=Side view"))).toBe("?tags=Side+view,Platform");
  });
  it("search matches title and genre", () => {
    expect(verdictFor(contra, f("q=shoot"))).toBe("yes");
    expect(verdictFor(zelda, f("q=shoot"))).toBe("no");
  });
  it("hides handheld-only games but keeps hybrids and games with a console copy", () => {
    const gameBoy = game({ title: "Tetris", platform: "gb", platformLabel: "GB" });
    const switchGame = game({ title: "Mario Kart 8", platform: "switch", platformLabel: "Switch" });
    const crossPlatform = game({
      title: "Rayman",
      copies: [
        { ownedId: "rayman-gba", platform: "gba", platformLabel: "GBA", quantity: 1 },
        { ownedId: "rayman-ps1", platform: "ps1", platformLabel: "PS1", quantity: 1 },
      ],
    });
    expect(verdictFor(gameBoy, f("handhelds=hide"))).toBe("no");
    expect(verdictFor(switchGame, f("handhelds=hide"))).toBe("yes");
    expect(verdictFor(crossPlatform, f("handhelds=hide"))).toBe("yes");
  });
});

describe("applyFilters", () => {
  it("splits confirmed and maybe, and strict hides maybe", () => {
    const r = applyFilters(all, parseFilters(new URLSearchParams("players=2&mode=coop")));
    expect(r.confirmed.map((g) => g.title)).toEqual(["Contra"]);
    expect(r.maybe.map((g) => g.title)).toEqual(["Mystery"]);
    expect(r.excluded).toBe(2);
    const s = applyFilters(all, parseFilters(new URLSearchParams("players=2&mode=coop&strict=1")));
    expect(s.maybe).toEqual([]);
    expect(s.excluded).toBe(3);
  });
  it("sorts by title ignoring articles, and shuffles deterministically", () => {
    const the = game({ title: "The Aardvark" });
    const r = applyFilters([zelda, the, contra], parseFilters(new URLSearchParams("")));
    expect(r.confirmed.map((g) => g.title)).toEqual(["The Aardvark", "Contra", "Zelda"]);
    const a = seededShuffle([1, 2, 3, 4, 5, 6], 42);
    expect(seededShuffle([1, 2, 3, 4, 5, 6], 42)).toEqual(a);
    expect(seededShuffle([1, 2, 3, 4, 5, 6], 43)).not.toEqual(a);
  });
});

describe("facets and picks", () => {
  it("counts platforms and genres", () => {
    const f = facets(all);
    expect(f.platforms).toEqual([
      { slug: "nes", label: "NES", count: 3 },
      { slug: "snes", label: "SNES", count: 1 },
    ]);
    expect(f.genres.map((g) => g.name)).toEqual(["Adventure", "Shooter", "Sport"]);
    expect(f.perspectives).toEqual([]);
  });
  it("tonight's picks are stable for a date", () => {
    const d = new Date(2026, 7, 28);
    expect(tonightsPicks(all, d, 3)).toEqual(tonightsPicks(all, d, 3));
    expect(tonightsPicks(all, d, 3)).toHaveLength(3);
  });
});

/**
 * Two-valued, unlike every other verdict here: there is no "unknown" branch to
 * test, because no sessions means never played rather than no data.
 */
describe("play state", () => {
  const never = game({ title: "Untouched" });
  const playing = game({ title: "Open", play: played({ status: "playing", runs: 1, lastPlayedAt: new Date("2026-08-01") }) });
  const done = game({ title: "Finished", play: played({ status: "played", runs: 2, lastPlayedAt: new Date("2026-01-01") }) });

  it("matches exactly one of the three states and never answers unknown", () => {
    for (const g of [never, playing, done]) {
      const verdicts = (["playing", "played", "never"] as const).map((v) => playVerdict(g, v));
      expect(verdicts.filter((v) => v === "yes")).toHaveLength(1);
      expect(verdicts).not.toContain("unknown");
    }
    expect(playVerdict(never, "never")).toBe("yes");
    expect(playVerdict(playing, "playing")).toBe("yes");
    expect(playVerdict(done, "played")).toBe("yes");
  });

  it("filters the shelf, and never-played games are excluded rather than 'could work'", () => {
    const shelf = [never, playing, done];
    const r = applyFilters(shelf, parseFilters(new URLSearchParams("play=never")));
    expect(r.confirmed.map((g) => g.name)).toEqual(["Untouched"]);
    expect(r.maybe).toEqual([]);
    expect(r.excluded).toBe(2);
    expect(applyFilters(shelf, parseFilters(new URLSearchParams("play=playing"))).confirmed.map((g) => g.name)).toEqual(["Open"]);
  });
});
