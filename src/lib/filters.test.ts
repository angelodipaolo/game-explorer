import { describe, expect, it } from "vitest";
import type { ShelfGame } from "./collection";
import { applyFilters, facets, parseFilters, seededShuffle, serializeFilters, tonightsPicks, verdictFor } from "./filters";

function game(over: Partial<ShelfGame> & { title: string }): ShelfGame {
  return {
    id: over.title.toLowerCase(),
    name: over.title,
    platform: "nes",
    platformLabel: "NES",
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
    similar: [],
    summary: null,
    ...over,
  };
}

const contra = game({ title: "Contra", players: { label: "", tier: "exact", max: 2, coop: true, multiplayer: true, single: true, simultaneous: true, verified: false }, genres: ["Shooter"] });
const zelda = game({ title: "Zelda", players: { label: "", tier: "mode", max: 1, coop: false, multiplayer: false, single: true, simultaneous: false, verified: false }, genres: ["Adventure"], playtime: 600 });
const mystery = game({ title: "Mystery", year: null });
const tecmo = game({ title: "Tecmo Bowl", players: { label: "", tier: "mode", max: null, coop: false, multiplayer: true, single: true, simultaneous: null, verified: false }, genres: ["Sport"], platform: "snes", platformLabel: "SNES" });
const all = [contra, zelda, mystery, tecmo];

describe("parse/serialize", () => {
  it("round-trips through the URL and drops defaults", () => {
    const f = parseFilters(new URLSearchParams("platform=nes&players=2&mode=coop&view=list&sort=shuffle&seed=7&strict=1&q=con"));
    expect(f).toMatchObject({ platform: "nes", players: 2, mode: "coop", view: "list", sort: "shuffle", seed: 7, strict: true, q: "con" });
    expect(serializeFilters(f)).toBe("?q=con&platform=nes&players=2&mode=coop&strict=1&view=list&sort=shuffle&seed=7");
    expect(serializeFilters(parseFilters({}))).toBe("");
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
  it("search matches title and genre", () => {
    expect(verdictFor(contra, f("q=shoot"))).toBe("yes");
    expect(verdictFor(zelda, f("q=shoot"))).toBe("no");
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
    expect(f.genres.map((g) => g.name)).toEqual(["Shooter", "Adventure", "Sport"]);
  });
  it("tonight's picks are stable for a date", () => {
    const d = new Date(2026, 7, 28);
    expect(tonightsPicks(all, d, 3)).toEqual(tonightsPicks(all, d, 3));
    expect(tonightsPicks(all, d, 3)).toHaveLength(3);
  });
});
