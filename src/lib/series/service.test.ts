import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import type { SeriesSeed } from "@/lib/catalog/collections";
import { MAX_ENTRIES_PER_SERIES, addEntries, addEntriesSchema, checkSeed, createSeries, entryInputSchema, listSeries, removeEntries, reorderEntries, seriesBySlug, seriesForGame, updateEntry, type Hydrate } from "./service";
import { groupBySection, missingHref, newSinceLastPrune, parseMissing, seenIdsOf, slugify, uniqueSlug } from "./shape";

/** Nothing here talks to IGDB: entries are hydrated by hand into the test catalog. */
const noHydrate: Hydrate = async () => {};

const catalog = (igdbId: number, name: string, over: { parentIgdbId?: number; cover?: string; year?: number } = {}) =>
  prisma.catalogGame.create({
    data: {
      igdbId,
      name,
      slug: name.toLowerCase().replace(/\s+/g, "-"),
      detail: "full",
      parentIgdbId: over.parentIgdbId ?? null,
      coverImageId: over.cover ?? null,
      firstReleaseDate: over.year ? new Date(Date.UTC(over.year, 0, 1)) : null,
    },
  });

const own = (title: string, platform: string, catalogGameId: number | null = null) =>
  prisma.ownedGame.create({ data: { title, normalizedTitle: title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(), platform, catalogGameId } });

const status = async (fn: () => Promise<unknown>) => {
  try {
    await fn();
    return 0;
  } catch (e) {
    return (e as { status?: number }).status ?? -1;
  }
};

beforeEach(async () => {
  await prisma.seriesEntry.deleteMany();
  await prisma.series.deleteMany();
  await prisma.ownedGame.deleteMany();
  await prisma.catalogGame.deleteMany();
});

describe("slugs", () => {
  it("folds accents and punctuation", () => {
    expect(slugify("Final Fantasy")).toBe("final-fantasy");
    expect(slugify("Pokémon: Red & Blue")).toBe("pokemon-red-blue");
    expect(slugify("  ???  ")).toBe("");
    expect(uniqueSlug("???", [])).toBe("series");
  });

  it("keeps even the last-resort slug inside the 80-char cap", () => {
    const long = "a".repeat(120);
    const taken = [slugify(long), ...Array.from({ length: 998 }, (_, i) => `${slugify(long)}-${i + 2}`)];
    const slug = uniqueSlug(long, taken);
    expect(slug.length).toBeLessThanOrEqual(80);
    expect(taken).not.toContain(slug);
  });

  it("gives the second series of the same name its own handle", async () => {
    const a = await createSeries({ name: "Final Fantasy" }, noHydrate);
    const b = await createSeries({ name: "Final Fantasy" }, noHydrate);
    expect(a.slug).toBe("final-fantasy");
    expect(b.slug).toBe("final-fantasy-2");
  });

  it("refuses to silently rename a slug that was asked for by name", async () => {
    await createSeries({ name: "Mario Party", slug: "mario-party" }, noHydrate);
    expect(await status(() => createSeries({ name: "Mario Party Again", slug: "mario-party" }, noHydrate))).toBe(409);
  });
});

describe("entry validation", () => {
  it("needs an IGDB id or a title, and takes either", () => {
    expect(entryInputSchema.safeParse({}).success).toBe(false);
    expect(entryInputSchema.safeParse({ title: "   " }).success).toBe(false);
    expect(entryInputSchema.safeParse({ igdbId: 1029 }).success).toBe(true);
    // IGDB has no entry for Roller Games — a title alone is a real member.
    expect(entryInputSchema.safeParse({ title: "Roller Games" }).success).toBe(true);
    expect(entryInputSchema.safeParse({ igdbId: 1029, title: "Final Fantasy I" }).success).toBe(true);
  });

  it("will not empty the title of an entry that has no id to fall back on", async () => {
    const s = await createSeries({ name: "Odds", entries: [{ title: "Roller Games" }] }, noHydrate);
    expect(await status(() => updateEntry(s.entries[0].id, { title: "" }))).toBe(400);
  });
});

describe("entries", () => {
  it("appends with dense positions and reports an id already in the series", async () => {
    const s = await createSeries({ name: "Contra", entries: [{ igdbId: 100 }] }, noHydrate);
    const added = await addEntries(s.id, [{ igdbId: 200 }, { igdbId: 100 }, { igdbId: 300 }], { hydrate: noHydrate });
    expect(added.added.map((e) => e.igdbId)).toEqual([200, 300]);
    expect(added.skipped).toEqual([{ igdbId: 100, title: null, reason: "already in this series" }]);
    // Nothing hydrated in this test, so every id is reported as having no
    // catalog row — the state a game_type-excluded id lands in for real.
    expect(added.unhydrated).toEqual([200, 300]);
    const view = await seriesBySlug(s.slug);
    expect(view!.entries.map((e) => e.position)).toEqual([0, 1, 2]);
    expect(view!.entries.map((e) => e.igdbId)).toEqual([100, 200, 300]);
  });

  it("applies the size cap to what would actually be stored, not to the batch", async () => {
    const full = Array.from({ length: MAX_ENTRIES_PER_SERIES }, (_, i) => ({ igdbId: i + 1 }));
    const s = await createSeries({ name: "Everything", entries: full }, noHydrate);
    expect((await seriesBySlug(s.slug))!.total).toBe(MAX_ENTRIES_PER_SERIES);
    // Re-POSTing the same list adds nothing, so a full series does not 409 for
    // ids it already holds — only genuinely new ones are counted against it.
    const again = await addEntries(s.id, full, { hydrate: noHydrate });
    expect(again.added).toEqual([]);
    expect(again.skipped.length).toBe(MAX_ENTRIES_PER_SERIES);
    expect(await status(() => addEntries(s.id, [{ igdbId: 9999 }], { hydrate: noHydrate }))).toBe(409);
  });

  it("lets the same game belong to several series", async () => {
    const a = await createSeries({ name: "Mario Party", entries: [{ igdbId: 500 }] }, noHydrate);
    const b = await createSeries({ name: "Mario", entries: [{ igdbId: 500 }] }, noHydrate);
    expect((await seriesBySlug(a.slug))!.total).toBe(1);
    expect((await seriesBySlug(b.slug))!.total).toBe(1);
  });

  it("reorders by permutation and rejects a list that is not one", async () => {
    const s = await createSeries({ name: "FF", entries: [{ igdbId: 1 }, { igdbId: 2 }, { igdbId: 3 }] }, noHydrate);
    const ids = s.entries.map((e) => e.id);
    const rows = await reorderEntries(s.id, [ids[2], ids[0], ids[1]]);
    expect(rows.map((r) => r.igdbId)).toEqual([3, 1, 2]);
    expect(rows.map((r) => r.position)).toEqual([0, 1, 2]);
    // A partial list would silently push the entries it forgot to the end.
    expect(await status(() => reorderEntries(s.id, [ids[0], ids[1]]))).toBe(400);
    expect(await status(() => reorderEntries(s.id, [ids[0], ids[0], ids[1]]))).toBe(400);
  });

  it("closes the gap when an entry is removed", async () => {
    const s = await createSeries({ name: "FF", entries: [{ igdbId: 1 }, { igdbId: 2 }, { igdbId: 3 }] }, noHydrate);
    const rows = await removeEntries(s.id, [s.entries[1].id]);
    expect(rows.map((r) => [r.igdbId, r.position])).toEqual([
      [1, 0],
      [3, 2 - 1],
    ]);
  });
});

describe("ownership", () => {
  it("resolves an entry through the port you actually own, and both ways round", async () => {
    await catalog(100, "Contra", { cover: "cov100", year: 1987 });
    await catalog(101, "Contra (NES)", { parentIgdbId: 100 });
    await catalog(102, "Super C");
    const nes = await own("Contra", "nes", 101);

    // The series lists the arcade original; the shelf holds the NES port.
    const s = await createSeries({ name: "Contra", entries: [{ igdbId: 100 }, { igdbId: 102 }] }, noHydrate);
    const view = await seriesBySlug(s.slug);
    expect(view!.entries[0].ownedId).toBe(nes.id);
    expect(view!.entries[1].ownedId).toBeNull();
    expect([view!.owned, view!.total]).toEqual([1, 2]);
  });

  it("resolves the other direction too: the series lists a port, the shelf holds the original", async () => {
    await catalog(100, "Contra");
    await catalog(101, "Contra (NES)", { parentIgdbId: 100 });
    const arcade = await own("Contra Original", "arcade", 100);
    const s = await createSeries({ name: "Contra Ports", entries: [{ igdbId: 101 }] }, noHydrate);
    expect((await seriesBySlug(s.slug))!.entries[0].ownedId).toBe(arcade.id);
  });

  it("matches a free-text entry on its normalised title", async () => {
    const roller = await own("Roller Games", "nes", null);
    const s = await createSeries({ name: "Odd ones", entries: [{ title: "roller games" }, { title: "Never Owned" }] }, noHydrate);
    const view = await seriesBySlug(s.slug);
    expect(view!.entries[0].ownedId).toBe(roller.id);
    expect(view!.entries[0].name).toBe("roller games");
    expect(view!.owned).toBe(1);
  });

  it("counts one cartridge once, and the exact entry keeps it rather than the earlier parent", async () => {
    await catalog(100, "Contra");
    await catalog(101, "Contra (NES)", { parentIgdbId: 100 });
    const nes = await own("Contra", "nes", 101);
    // The series lists the arcade original first and the NES port second; the
    // cartridge on the shelf IS the port, so the port's row is the owned one.
    const s = await createSeries({ name: "Contra", entries: [{ igdbId: 100 }, { igdbId: 101 }] }, noHydrate);
    const view = await seriesBySlug(s.slug);
    expect(view!.owned).toBe(1);
    expect(view!.entries[0].ownedId).toBeNull();
    expect(view!.entries[1].ownedId).toBe(nes.id);
  });

  it("derives the card cover from the first entry that has art, unless overridden", async () => {
    await catalog(1, "No art");
    await catalog(2, "Has art", { cover: "cov2" });
    await createSeries({ name: "Derived", entries: [{ igdbId: 1 }, { igdbId: 2 }] }, noHydrate);
    await createSeries({ name: "Overridden", coverImageId: "chosen", entries: [{ igdbId: 2 }] }, noHydrate);
    const cards = await listSeries();
    expect(cards.find((c) => c.name === "Derived")!.cover).toBe("cov2");
    expect(cards.find((c) => c.name === "Overridden")!.cover).toBe("chosen");
  });

  it("sorts the index by position then name", async () => {
    await createSeries({ name: "Zelda", position: 0 }, noHydrate);
    await createSeries({ name: "Alpha", position: 5 }, noHydrate);
    await createSeries({ name: "Beta", position: 0 }, noHydrate);
    expect((await listSeries()).map((c) => c.name)).toEqual(["Beta", "Zelda", "Alpha"]);
  });
});

describe("seriesForGame", () => {
  it("finds the series that lists the game, its parent, or a port of it", async () => {
    await catalog(100, "Contra");
    await catalog(101, "Contra (NES)", { parentIgdbId: 100 });
    await createSeries({ name: "Konami runs", entries: [{ igdbId: 100 }] }, noHydrate);
    // Own the port: the series lists the parent.
    expect((await seriesForGame({ igdbId: 101, parentIgdbId: 100 })).map((s) => s.name)).toEqual(["Konami runs"]);
    // Own the parent: the series would list the port.
    await createSeries({ name: "Ports only", entries: [{ igdbId: 101 }] }, noHydrate);
    expect((await seriesForGame({ igdbId: 100, parentIgdbId: null })).map((s) => s.name)).toEqual(["Konami runs", "Ports only"]);
    // A cartridge with no catalog link belongs to nothing.
    expect(await seriesForGame({ igdbId: null, parentIgdbId: null })).toEqual([]);
  });
});

describe("the seed diff", () => {
  const candidate = (igdbId: number, name: string, variants: number[] = []) => ({
    igdbId,
    name,
    cover: null,
    year: null,
    variants: variants.map((v) => ({ igdbId: v, name: `${name} port`, year: null })),
    ownedId: null,
    platformLabel: null,
  });

  it("reports only what neither the entries nor a previous prune already covered", () => {
    expect(newSinceLastPrune([1, 2, 3, 4], [1, 2], [3])).toEqual([4]);
    // A game turned down in the last prune is "seen" and never comes back.
    expect(newSinceLastPrune([1, 2], [2], [1])).toEqual([]);
    // An entry added by hand was never shown, but is still not new.
    expect(newSinceLastPrune([1, 2], [], [1, 2])).toEqual([]);
  });

  it("checkSeed hides what is known and folds a new port into the entry it belongs to", async () => {
    const s = await createSeries({ name: "Mario Party", seedCollectionId: 453, seen: [10, 11], entries: [{ igdbId: 10 }] }, noHydrate);
    const seed: SeriesSeed = {
      collection: { id: 453, name: "Mario Party", slug: "mario-party", gameIds: [10, 11, 12, 13] },
      // 10 is an entry, 11 was turned down, 12 is genuinely new, and 13 is a
      // fresh candidate that collapsed the known id 11 into itself.
      candidates: [candidate(10, "Mario Party"), candidate(11, "Minigame"), candidate(12, "Mario Party 2"), candidate(13, "Mario Party JP", [11])],
      skipped: [99],
    };
    const check = await checkSeed(s.id, async () => seed);
    expect(check.fresh.map((c) => c.igdbId)).toEqual([12]);
    expect(check.skipped).toEqual([99]);
    expect(check.collection.name).toBe("Mario Party");
  });

  it("accepting entries records everything that was offered, so the next check stays quiet", async () => {
    const s = await createSeries({ name: "FF", seedCollectionId: 39, seen: [], entries: [] }, noHydrate);
    await addEntries(s.id, [{ igdbId: 12 }], { seen: [12, 13], hydrate: noHydrate });
    const row = await prisma.series.findUniqueOrThrow({ where: { id: s.id } });
    expect(JSON.parse(row.seenIgdbIds)).toEqual([12, 13]);
    expect(row.seedCheckedAt).not.toBeNull();
  });

  it("records a check that rejected everything, so nothing it offered comes back", async () => {
    const s = await createSeries({ name: "FF", seedCollectionId: 39, seen: [1], entries: [{ igdbId: 1 }] }, noHydrate);
    // The body a reject-all accept sends: no entries, only what was shown.
    const body = addEntriesSchema.parse({ seen: [2, 3] });
    expect(body.entries).toEqual([]);
    const result = await addEntries(s.id, body.entries, { seen: body.seen, hydrate: noHydrate });
    expect(result.added).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(JSON.parse((await prisma.series.findUniqueOrThrow({ where: { id: s.id } })).seenIgdbIds)).toEqual([1, 2, 3]);

    const seed: SeriesSeed = {
      collection: { id: 39, name: "FF", slug: "ff", gameIds: [1, 2, 3] },
      candidates: [candidate(1, "FF"), candidate(2, "Rejected"), candidate(3, "Also rejected")],
      skipped: [],
    };
    expect((await checkSeed(s.id, async () => seed)).fresh).toEqual([]);
    // A body that neither adds nor records is not a request.
    expect(addEntriesSchema.safeParse({}).success).toBe(false);
    expect(addEntriesSchema.safeParse({ entries: [], seen: [] }).success).toBe(false);
  });

  it("never re-offers a port that was collapsed into something already seen", async () => {
    // seenIdsOf is what the pruning screen writes: primaries AND the ports
    // folded into them.
    expect(seenIdsOf([{ igdbId: 10, variants: [{ igdbId: 11 }] }, { igdbId: 12, variants: [] }])).toEqual([10, 11, 12]);

    const s = await createSeries({ name: "Mario Party", seedCollectionId: 453, seen: seenIdsOf([{ igdbId: 10, variants: [{ igdbId: 11 }] }]), entries: [{ igdbId: 10 }] }, noHydrate);
    // IGDB later drops the parent link on 11, so it arrives as its own
    // candidate rather than as a variant of 10. It was still shown once.
    const seed: SeriesSeed = {
      collection: { id: 453, name: "Mario Party", slug: "mario-party", gameIds: [10, 11] },
      candidates: [candidate(10, "Mario Party"), candidate(11, "Mario Party JP")],
      skipped: [],
    };
    expect((await checkSeed(s.id, async () => seed)).fresh).toEqual([]);
  });

  it("stamps when it looked, and changes nothing else", async () => {
    const s = await createSeries({ name: "FF", seedCollectionId: 39, seen: [1], entries: [{ igdbId: 1 }] }, noHydrate);
    expect((await prisma.series.findUniqueOrThrow({ where: { id: s.id } })).seedCheckedAt).toBeNull();
    const seed: SeriesSeed = { collection: { id: 39, name: "FF", slug: "ff", gameIds: [1, 2] }, candidates: [candidate(1, "FF"), candidate(2, "FF II")], skipped: [] };

    const check = await checkSeed(s.id, async () => seed);
    expect(check.fresh.map((c) => c.igdbId)).toEqual([2]);
    const row = await prisma.series.findUniqueOrThrow({ where: { id: s.id }, include: { entries: true } });
    expect(row.seedCheckedAt).toEqual(check.checkedAt);
    // Reporting is not merging: 2 is neither an entry nor now "seen".
    expect(JSON.parse(row.seenIgdbIds)).toEqual([1]);
    expect(row.entries.map((e) => e.igdbId)).toEqual([1]);
    // …so it is still fresh on the next check.
    expect((await checkSeed(s.id, async () => seed)).fresh.map((c) => c.igdbId)).toEqual([2]);
  });

  it("refuses a check on a series that was never seeded", async () => {
    const s = await createSeries({ name: "By hand" }, noHydrate);
    expect(await status(() => checkSeed(s.id, async () => { throw new Error("IGDB must not be asked"); }))).toBe(400);
  });
});

describe("the ?missing toggle", () => {
  it("is off unless the URL says otherwise", () => {
    expect(parseMissing(undefined)).toBe(false);
    expect(parseMissing({})).toBe(false);
    expect(parseMissing({ missing: "0" })).toBe(false);
    expect(parseMissing({ missing: "" })).toBe(false);
    expect(parseMissing({ missing: "1" })).toBe(true);
    expect(parseMissing({ missing: "true" })).toBe(true);
    expect(parseMissing({ missing: ["1", "0"] })).toBe(true);
    expect(parseMissing(new URLSearchParams("missing=1"))).toBe(true);
    expect(parseMissing(new URLSearchParams("q=contra"))).toBe(false);
  });

  it("links both ways, and the default view carries no parameter", () => {
    expect(missingHref("final-fantasy", true)).toBe("/series/final-fantasy?missing=1");
    expect(missingHref("final-fantasy", false)).toBe("/series/final-fantasy");
  });
});

describe("sections", () => {
  it("groups in the order the headings first appear, keeping entry order inside", async () => {
    const s = await createSeries(
      {
        name: "FF",
        entries: [{ igdbId: 1, section: "Mainline" }, { igdbId: 2, section: "Spin-offs" }, { igdbId: 3, section: "Mainline" }, { igdbId: 4 }],
      },
      noHydrate,
    );
    const view = await seriesBySlug(s.slug);
    expect(view!.sections.map((g) => [g.section, g.entries.map((e) => e.igdbId)])).toEqual([
      ["Mainline", [1, 3]],
      ["Spin-offs", [2]],
      [null, [4]],
    ]);
    expect(groupBySection([{ section: "  " }, { section: null }])).toEqual([{ section: null, entries: [{ section: "  " }, { section: null }] }]);
  });
});
