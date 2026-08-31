import type { Series, SeriesEntry } from "@prisma/client";
import { z } from "zod";
import type { SeriesCandidate, SeriesSeed } from "@/lib/catalog/collections";
import { normalizeTitle } from "@/lib/catalog/normalize";
import { prisma } from "@/lib/db";
import { EnrichmentError } from "@/lib/enrichment/service";
import { matchSimilarToOwned } from "@/lib/owned-match";
import { platformLabel } from "@/lib/platforms";
import { MAX_BLURB, MAX_ENTRIES_PER_SERIES, groupBySection, newSinceLastPrune, uniqueSlug } from "./shape";

/**
 * Series: ordered lists of *catalog* games, with ownership resolved at render
 * time.
 *
 * The one decision that shapes everything is that membership is by IGDB id and
 * not by owned copy. A series page that listed only what you own would be a
 * saved shelf filter; one that lists the whole series and marks what is
 * missing answers the question a collector actually opens it to ask.
 *
 * Stance is codes-and-maps, not play-history: no `source` column, no
 * precedence, one API shared by the owner and by a research skill. A series is
 * a public fact about games.
 *
 * IGDB seeds and a person prunes — see src/lib/catalog/collections.ts. Nothing
 * here publishes a collection automatically, and `checkSeed` reports rather
 * than merges.
 */

const text = (max: number) => z.string().trim().max(max).nullish();
const blank = (v: string | null | undefined) => (v === undefined ? undefined : v || null);
const urlField = z.union([z.literal(""), z.string().trim().url().max(500)]).nullish();

const slugField = z
  .string()
  .trim()
  .toLowerCase()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug must be lower-case words joined by hyphens");

/**
 * An entry is an IGDB id **or** a free-text title — the same tolerance
 * `OwnedGame.catalogGameId` being null gives a game like Roller Games, which
 * IGDB has no entry for at all. Neither is a 400: an entry with no name and no
 * id is not a place in a list.
 */
export const entryInputSchema = z
  .object({
    igdbId: z.number().int().positive().nullish(),
    title: text(200),
    section: text(60),
    note: text(300),
    sourceUrl: urlField,
  })
  .refine((e) => e.igdbId != null || !!e.title?.trim(), { message: "an entry needs an igdbId or a title" });
export type EntryInput = z.infer<typeof entryInputSchema>;

/**
 * `entries` may be empty when `seen` is not: rejecting *every* id a seed check
 * offered is a real outcome, and it has to be recordable or the same rejects
 * come back on the next check. What is not a request is a body that neither
 * adds anything nor records anything.
 */
export const addEntriesSchema = z
  .object({
    entries: z.array(entryInputSchema).max(MAX_ENTRIES_PER_SERIES).default([]),
    /**
     * Ids the owner has now been shown and has decided about — kept or turned
     * down. Recorded so "check for new entries" never re-offers a deliberate no.
     */
    seen: z.array(z.number().int().positive()).max(2000).optional(),
  })
  .refine((b) => b.entries.length > 0 || !!b.seen?.length, { message: "pass entries to add, seen ids to record, or both" });

export const seriesInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  /** Optional: derived from the name when absent, de-duplicated either way. */
  slug: slugField.optional(),
  blurb: text(MAX_BLURB),
  /** An IGDB image id, overriding the cover derived from the first entry that has one. */
  coverImageId: text(64),
  position: z.number().int().min(0).max(999).optional(),
  seedCollectionId: z.number().int().positive().nullish(),
  seen: z.array(z.number().int().positive()).max(2000).optional(),
  entries: z.array(entryInputSchema).max(MAX_ENTRIES_PER_SERIES).optional(),
});
export type SeriesInput = z.infer<typeof seriesInputSchema>;

export const seriesPatchSchema = seriesInputSchema.partial().omit({ entries: true, seen: true });
export type SeriesPatch = z.infer<typeof seriesPatchSchema>;

export const entryPatchSchema = z.object({ title: text(200), section: text(60), note: text(300), sourceUrl: urlField });
export type EntryPatch = z.infer<typeof entryPatchSchema>;

/** Reorder is a permutation, like manual pages and the play queue: the whole list, exactly once. */
export const reorderEntriesSchema = z.object({ orderedIds: z.array(z.string().min(1)).max(MAX_ENTRIES_PER_SERIES) });
export const removeEntriesSchema = z.object({ ids: z.array(z.string().min(1)).min(1).max(MAX_ENTRIES_PER_SERIES) });

type Tx = Parameters<Parameters<typeof prisma.$transaction>[0]>[0];

/* --------------------------------------------------------------- view models */

export type SeriesEntryView = {
  id: string;
  igdbId: number | null;
  /** The catalog name, or the free-text title when there is no catalog row. */
  name: string;
  cover: string | null;
  year: number | null;
  section: string | null;
  note: string | null;
  sourceUrl: string | null;
  position: number;
  /** The owned copy behind this entry, when there is one. Null renders as "not owned". */
  ownedId: string | null;
  platformLabel: string | null;
};

export type SeriesCard = {
  id: string;
  name: string;
  slug: string;
  blurb: string | null;
  /** The override, else the first entry with art. */
  cover: string | null;
  owned: number;
  total: number;
  position: number;
};

export type SeriesView = SeriesCard & {
  seedCollectionId: number | null;
  seedCheckedAt: Date | null;
  entries: SeriesEntryView[];
  /** Entries grouped under their section headings, in order. */
  sections: { section: string | null; entries: SeriesEntryView[] }[];
};

export type SeriesLink = { id: string; name: string; slug: string };

/* ------------------------------------------------------------------ resolving */

type OwnedLink = { id: string; catalogGameId: number | null; platform: string; normalizedTitle: string; parentIgdbId: number | null };

async function ownedLinks(): Promise<OwnedLink[]> {
  const rows = await prisma.ownedGame.findMany({ select: { id: true, catalogGameId: true, platform: true, normalizedTitle: true, catalogGame: { select: { parentIgdbId: true } } } });
  return rows.map((o) => ({ id: o.id, catalogGameId: o.catalogGameId, platform: o.platform, normalizedTitle: o.normalizedTitle, parentIgdbId: o.catalogGame?.parentIgdbId ?? null }));
}

/**
 * Turn stored entries into what the page renders, resolving ownership exactly
 * the way the similar-games strip does: an id matches an owned copy through
 * the catalog id, the owned row's parent, or the entry's own parent — because
 * a series lists "Contra" the arcade original while the shelf holds the NES
 * port.
 *
 * A free-text entry (no IGDB id) still matches on the normalised title, so an
 * entry for a game IGDB has never heard of is not permanently "not owned".
 *
 * An entry whose IGDB id has no catalog row at all — the game_type rule
 * refuses DLC and expansions, so hydration can come back empty — renders as
 * "IGDB #<id>" rather than disappearing.
 *
 * One owned copy backs at most one entry: if two rows resolve to the same
 * cartridge, exactly one keeps it and "you own 7 of 16" stays true. The one
 * that keeps it is the entry whose IGDB id **is** the cartridge's catalog id,
 * even when a parent-collapse match sits at an earlier position — a series
 * listing both the arcade original and the NES port should mark the port you
 * actually own, not the original. Ties within one kind of match go to the
 * earlier position.
 */
export function resolveEntries(
  entries: Pick<SeriesEntry, "id" | "igdbId" | "title" | "section" | "note" | "sourceUrl" | "position">[],
  catalog: Map<number, { name: string; coverImageId: string | null; firstReleaseDate: Date | null; parentIgdbId: number | null }>,
  owned: OwnedLink[],
): SeriesEntryView[] {
  const igdbIds = entries.map((e) => e.igdbId).filter((x): x is number => x != null);
  const matches = matchSimilarToOwned(
    igdbIds,
    new Map([...catalog.entries()].map(([id, c]) => [id, c.parentIgdbId])),
    owned.map((o) => ({ id: o.id, catalogGameId: o.catalogGameId, parentIgdbId: o.parentIgdbId })),
  );
  const byTitle = new Map<string, string>();
  for (const o of owned) if (!byTitle.has(o.normalizedTitle)) byTitle.set(o.normalizedTitle, o.id);
  const platformOf = new Map(owned.map((o) => [o.id, o.platform]));

  // The exact catalog id of an owned copy, so an entry for the cartridge on the
  // shelf outranks an entry for the original it descends from.
  const exact = new Map<number, string>();
  for (const o of owned) if (o.catalogGameId != null && !exact.has(o.catalogGameId)) exact.set(o.catalogGameId, o.id);

  const ordered = [...entries].sort((a, b) => a.position - b.position);
  const claimed = new Set<string>();
  const owner = new Map<string, string>();
  // Two passes, exact matches first; within a pass the earlier position wins.
  for (const e of ordered) {
    const hit = e.igdbId != null ? exact.get(e.igdbId) : undefined;
    if (hit && !claimed.has(hit)) {
      claimed.add(hit);
      owner.set(e.id, hit);
    }
  }
  for (const e of ordered) {
    if (owner.has(e.id)) continue;
    const hit = (e.igdbId != null ? matches.get(e.igdbId) : e.title ? byTitle.get(normalizeTitle(e.title)) : undefined) ?? null;
    if (hit && !claimed.has(hit)) {
      claimed.add(hit);
      owner.set(e.id, hit);
    }
  }

  return ordered
    .map((e) => {
      const c = e.igdbId != null ? catalog.get(e.igdbId) : undefined;
      const ownedId = owner.get(e.id) ?? null;
      return {
        id: e.id,
        igdbId: e.igdbId,
        name: e.title?.trim() || c?.name || (e.igdbId != null ? `IGDB #${e.igdbId}` : "Untitled"),
        cover: c?.coverImageId ?? null,
        year: c?.firstReleaseDate ? c.firstReleaseDate.getUTCFullYear() : null,
        section: e.section,
        note: e.note,
        sourceUrl: e.sourceUrl,
        position: e.position,
        ownedId,
        platformLabel: ownedId ? platformLabel(platformOf.get(ownedId)!) : null,
      };
    });
}

async function catalogFor(igdbIds: number[]) {
  const rows = igdbIds.length ? await prisma.catalogGame.findMany({ where: { igdbId: { in: [...new Set(igdbIds)] } }, select: { igdbId: true, name: true, coverImageId: true, firstReleaseDate: true, parentIgdbId: true } }) : [];
  return new Map(rows.map((r) => [r.igdbId, r]));
}

function card(s: Series, views: SeriesEntryView[]): SeriesCard {
  return {
    id: s.id,
    name: s.name,
    slug: s.slug,
    blurb: s.blurb,
    cover: s.coverImageId ?? views.find((v) => v.cover)?.cover ?? null,
    owned: views.filter((v) => v.ownedId).length,
    total: views.length,
    position: s.position,
  };
}

const byPositionThenName = (a: { position: number; name: string }, b: { position: number; name: string }) => a.position - b.position || a.name.localeCompare(b.name);

/**
 * Every series as a card. Three queries for the whole index however many
 * series there are — the catalog rows and the shelf are fetched once and
 * shared, never per series.
 */
export async function listSeries(): Promise<SeriesCard[]> {
  const rows = await prisma.series.findMany({ include: { entries: true } });
  if (!rows.length) return [];
  const catalog = await catalogFor(rows.flatMap((s) => s.entries.map((e) => e.igdbId).filter((x): x is number => x != null)));
  const owned = await ownedLinks();
  return rows.map((s) => card(s, resolveEntries(s.entries, catalog, owned))).sort(byPositionThenName);
}

export async function seriesBySlug(slug: string): Promise<SeriesView | null> {
  const s = await prisma.series.findUnique({ where: { slug }, include: { entries: true } });
  return s ? viewOf(s) : null;
}

export async function seriesById(id: string): Promise<SeriesView | null> {
  const s = await prisma.series.findUnique({ where: { id }, include: { entries: true } });
  return s ? viewOf(s) : null;
}

async function viewOf(s: Series & { entries: SeriesEntry[] }): Promise<SeriesView> {
  const catalog = await catalogFor(s.entries.map((e) => e.igdbId).filter((x): x is number => x != null));
  const entries = resolveEntries(s.entries, catalog, await ownedLinks());
  return { ...card(s, entries), seedCollectionId: s.seedCollectionId, seedCheckedAt: s.seedCheckedAt, entries, sections: groupBySection(entries) };
}

/**
 * The series a game belongs to, for the "Part of Final Fantasy →" line on a
 * game page.
 *
 * Two queries whatever the shelf looks like — never one per series. The second
 * one exists because the match runs both ways: the series may list the arcade
 * original of the port you own (covered by `parentIgdbId`), or it may list a
 * port of the original you own, which is what the catalog lookup finds.
 */
export async function seriesForGame(game: { igdbId: number | null; parentIgdbId: number | null }): Promise<SeriesLink[]> {
  const ids = [game.igdbId, game.parentIgdbId].filter((x): x is number => x != null);
  if (!ids.length) return [];
  const children = await prisma.catalogGame.findMany({ where: { parentIgdbId: { in: ids } }, select: { igdbId: true } });
  const entries = await prisma.seriesEntry.findMany({ where: { igdbId: { in: [...new Set([...ids, ...children.map((c) => c.igdbId)])] } }, include: { series: true } });
  const seen = new Map<string, Series>();
  for (const e of entries) if (!seen.has(e.seriesId)) seen.set(e.seriesId, e.series);
  return [...seen.values()].sort(byPositionThenName).map((s) => ({ id: s.id, name: s.name, slug: s.slug }));
}

/* -------------------------------------------------------------------- writing */

async function requireSeries(seriesId: string): Promise<Series> {
  const s = await prisma.series.findUnique({ where: { id: seriesId } });
  if (!s) throw new EnrichmentError("series not found", 404);
  return s;
}

async function slugFor(name: string, wanted: string | undefined, exceptId?: string): Promise<string> {
  const taken = (await prisma.series.findMany({ select: { id: true, slug: true } })).filter((s) => s.id !== exceptId).map((s) => s.slug);
  if (!wanted) return uniqueSlug(name, taken);
  // An explicitly asked-for slug is never silently renamed: a link that was
  // going to be /series/mario must not quietly become /series/mario-2.
  if (taken.includes(wanted)) throw new EnrichmentError(`a series already uses the slug "${wanted}"`, 409);
  return wanted;
}

/**
 * Pull catalog rows for ids nobody owns, so an entry renders with its real
 * cover and title. Injectable so the service's own tests never touch IGDB;
 * the default is the same `syncCatalog` the import path uses.
 */
export type Hydrate = (ids: number[]) => Promise<void>;
/**
 * Imported lazily, and so is `proposeMembers` in `checkSeed`: `collection.ts`
 * imports this module for the "Part of Final Fantasy →" line, so a static
 * import of anything under `src/lib/catalog` that reaches the IGDB client would
 * put it in every browse page's module graph. Only the write paths pay for it.
 */
const liveHydrate: Hydrate = async (ids) => {
  const { syncCatalog } = await import("@/lib/catalog/sync");
  await syncCatalog(ids, undefined, { withStubs: false });
};

async function hydrateMissing(igdbIds: number[], hydrate: Hydrate) {
  const wanted = [...new Set(igdbIds)];
  if (!wanted.length) return;
  const have = new Set((await prisma.catalogGame.findMany({ where: { igdbId: { in: wanted } }, select: { igdbId: true } })).map((r) => r.igdbId));
  const missing = wanted.filter((id) => !have.has(id));
  if (missing.length) await hydrate(missing);
}

/**
 * Interactive transactions default to a 5s budget, and these are row-at-a-time:
 * a 300-entry renumber is 600 updates. 30s is not a hope that a slow query
 * finishes, it is room for the biggest series the cap allows.
 */
const TX = { timeout: 30_000 } as const;

/** Renumber a series' entries 0..n-1, in two passes through a negative range so no intermediate state collides. */
async function renumber(tx: Tx, seriesId: string, ids: string[]) {
  for (const [i, id] of ids.entries()) await tx.seriesEntry.update({ where: { id }, data: { position: -1 - i } });
  for (const [i, id] of ids.entries()) await tx.seriesEntry.update({ where: { id }, data: { position: i } });
  return tx.seriesEntry.findMany({ where: { seriesId }, orderBy: { position: "asc" } });
}

export async function createSeries(input: SeriesInput, hydrate: Hydrate = liveHydrate): Promise<SeriesView> {
  const slug = await slugFor(input.name, input.slug);
  const entries = input.entries ?? [];
  await hydrateMissing(
    entries.map((e) => e.igdbId).filter((x): x is number => x != null),
    hydrate,
  );
  const s = await prisma.series.create({
    data: {
      name: input.name,
      slug,
      blurb: blank(input.blurb) ?? null,
      coverImageId: blank(input.coverImageId) ?? null,
      position: input.position ?? (await prisma.series.count()),
      seedCollectionId: input.seedCollectionId ?? null,
      // Everything the seed showed, kept or not — the baseline a later check diffs against.
      seenIgdbIds: JSON.stringify([...new Set(input.seen ?? [])]),
      entries: { create: dedupe(entries).map((e, i) => entryData(e, i)) },
    },
  });
  return (await seriesById(s.id))!;
}

export async function updateSeries(seriesId: string, patch: SeriesPatch): Promise<SeriesView> {
  const s = await requireSeries(seriesId);
  const slug = patch.slug && patch.slug !== s.slug ? await slugFor(patch.name ?? s.name, patch.slug, seriesId) : undefined;
  await prisma.series.update({
    where: { id: seriesId },
    data: { name: patch.name, slug, blurb: blank(patch.blurb), coverImageId: blank(patch.coverImageId), position: patch.position, seedCollectionId: patch.seedCollectionId === undefined ? undefined : (patch.seedCollectionId ?? null) },
  });
  return (await seriesById(seriesId))!;
}

export async function deleteSeries(seriesId: string): Promise<void> {
  const { count } = await prisma.series.deleteMany({ where: { id: seriesId } });
  if (!count) throw new EnrichmentError("series not found", 404);
}

function entryData(e: EntryInput, position: number) {
  return {
    igdbId: e.igdbId ?? null,
    title: blank(e.title) ?? null,
    section: blank(e.section) ?? null,
    note: blank(e.note) ?? null,
    sourceUrl: blank(e.sourceUrl) ?? null,
    position,
  };
}

/** Within one submission, the same IGDB id twice is one entry — the unique key would reject the second anyway. */
function dedupe(entries: EntryInput[]): EntryInput[] {
  const seen = new Set<number>();
  return entries.filter((e) => {
    if (e.igdbId == null) return true;
    if (seen.has(e.igdbId)) return false;
    seen.add(e.igdbId);
    return true;
  });
}

export type AddEntriesResult = {
  added: SeriesEntry[];
  skipped: { igdbId: number | null; title: string | null; reason: string }[];
  /**
   * Ids that were added but have no catalog row even after hydration — almost
   * always the `game_type` rule refusing a DLC or an expansion. The entry is
   * kept (dropping something the caller asked for silently is worse) and
   * renders as "IGDB #<id>" until it is removed or given a title.
   */
  unhydrated: number[];
};

/**
 * Append entries to a series. An id already in this series is reported in
 * `skipped` rather than 409-ing the batch — accepting three new Final Fantasy
 * entries should not fail because one of them was already there. The same id
 * in *another* series is fine and expected: membership is many-to-many.
 *
 * `inputs` may be empty when `seen` is not — that is a seed check where every
 * candidate was turned down, and recording it is the whole point: an id nobody
 * wants must not be offered again on the next check.
 */
export async function addEntries(seriesId: string, inputs: EntryInput[], opts: { seen?: number[]; hydrate?: Hydrate } = {}): Promise<AddEntriesResult> {
  await requireSeries(seriesId);
  const entries = dedupe(inputs);
  await hydrateMissing(
    entries.map((e) => e.igdbId).filter((x): x is number => x != null),
    opts.hydrate ?? liveHydrate,
  );
  const result = entries.length
    ? await prisma.$transaction(async (tx) => {
        const current = await tx.seriesEntry.findMany({ where: { seriesId }, select: { id: true, igdbId: true }, orderBy: { position: "asc" } });
        const have = new Set(current.map((c) => c.igdbId).filter((x): x is number => x != null));
        const out: Omit<AddEntriesResult, "unhydrated"> = { added: [], skipped: [] };
        const fresh: EntryInput[] = [];
        for (const e of entries) {
          if (e.igdbId != null && have.has(e.igdbId)) {
            out.skipped.push({ igdbId: e.igdbId, title: e.title ?? null, reason: "already in this series" });
            continue;
          }
          if (e.igdbId != null) have.add(e.igdbId);
          fresh.push(e);
        }
        // The cap counts what would actually be stored: re-POSTing forty entries
        // that are already in the series must not 409 a series that has room.
        if (current.length + fresh.length > MAX_ENTRIES_PER_SERIES) throw new EnrichmentError(`a series holds at most ${MAX_ENTRIES_PER_SERIES} entries`, 409);
        if (fresh.length) {
          const start = current.length;
          await tx.seriesEntry.createMany({ data: fresh.map((e, i) => ({ seriesId, ...entryData(e, start + i) })) });
          // Positions are dense 0..n-1 and the appended block starts at `start`,
          // so this is exactly the rows just created, in order.
          out.added = await tx.seriesEntry.findMany({ where: { seriesId, position: { gte: start } }, orderBy: { position: "asc" } });
        }
        return out;
      }, TX)
    : { added: [] as SeriesEntry[], skipped: [] as AddEntriesResult["skipped"] };
  if (opts.seen?.length) await markSeen(seriesId, opts.seen);
  const ids = result.added.map((e) => e.igdbId).filter((x): x is number => x != null);
  const have = new Set((await prisma.catalogGame.findMany({ where: { igdbId: { in: ids } }, select: { igdbId: true } })).map((r) => r.igdbId));
  return { ...result, unhydrated: ids.filter((id) => !have.has(id)) };
}

export async function updateEntry(entryId: string, patch: EntryPatch): Promise<SeriesEntry> {
  const e = await prisma.seriesEntry.findUnique({ where: { id: entryId } });
  if (!e) throw new EnrichmentError("series entry not found", 404);
  if (e.igdbId == null && patch.title !== undefined && !patch.title?.trim()) throw new EnrichmentError("an entry needs an igdbId or a title", 400);
  return prisma.seriesEntry.update({ where: { id: entryId }, data: { title: blank(patch.title), section: blank(patch.section), note: blank(patch.note), sourceUrl: blank(patch.sourceUrl) } });
}

/** Remove entries and close the gap, so positions stay dense 0..n-1. */
export async function removeEntries(seriesId: string, ids: string[]): Promise<SeriesEntry[]> {
  await requireSeries(seriesId);
  return prisma.$transaction(async (tx) => {
    const { count } = await tx.seriesEntry.deleteMany({ where: { seriesId, id: { in: ids } } });
    if (!count) throw new EnrichmentError("none of those entries are in this series", 404);
    const left = await tx.seriesEntry.findMany({ where: { seriesId }, orderBy: { position: "asc" }, select: { id: true } });
    return renumber(
      tx,
      seriesId,
      left.map((e) => e.id),
    );
  }, TX);
}

/**
 * Reorder by permutation: the body must list every entry of this series
 * exactly once. A partial list is a caller bug — accepting it would silently
 * push the entries it forgot to the end, and re-curating forty rows by hand is
 * not a recovery. Modelled on `reorderPages` and `reorderQueue`.
 *
 * The check and the renumber it guards share one transaction client, or an
 * entry added between them ends up holding a duplicate position.
 */
export async function reorderEntries(seriesId: string, orderedIds: string[]): Promise<SeriesEntry[]> {
  await requireSeries(seriesId);
  return prisma.$transaction(async (tx) => {
    const current = await tx.seriesEntry.findMany({ where: { seriesId }, select: { id: true } });
    const have = new Set(current.map((e) => e.id));
    const want = new Set(orderedIds);
    if (want.size !== orderedIds.length) throw new EnrichmentError("the same entry is listed twice", 400);
    if (have.size !== want.size || [...have].some((id) => !want.has(id))) {
      throw new EnrichmentError("the order must list exactly the entries in this series", 400, { entries: [...have] });
    }
    return renumber(tx, seriesId, orderedIds);
  }, TX);
}

/* ----------------------------------------------------------------- seed & diff */

/** Union new ids into what the owner has already been shown for this series. */
export async function markSeen(seriesId: string, ids: number[]): Promise<void> {
  const s = await requireSeries(seriesId);
  const seen = new Set<number>(JSON.parse(s.seenIgdbIds) as number[]);
  for (const id of ids) seen.add(id);
  await prisma.series.update({ where: { id: seriesId }, data: { seenIgdbIds: JSON.stringify([...seen]), seedCheckedAt: new Date() } });
}

export type SeedCheck = {
  collection: SeriesSeed["collection"];
  /** Only what has appeared since the last prune. Never merged automatically. */
  fresh: SeriesCandidate[];
  skipped: number[];
  /** The stamp this check just wrote — "checked just now", and later "checked on …". */
  checkedAt: Date;
};

export type Propose = (collectionId: number) => Promise<SeriesSeed>;

/**
 * Diff the seed collection against what this series already knows about.
 *
 * A review, not a merge: the caller shows these and the owner accepts the ones
 * that belong, then POSTs them as entries with `seen` covering everything that
 * was offered — including the ones turned down, which is what stops the same
 * rejects reappearing on every check. Neither `seen` nor the entries are
 * touched here; the one write a check makes is the `seedCheckedAt` stamp, so
 * the page can say when it last looked.
 *
 * The diff runs on collapsed candidates, so a newly added port of a game
 * already in the series folds into it instead of showing up as new.
 */
export async function checkSeed(seriesId: string, propose?: Propose): Promise<SeedCheck> {
  const s = await requireSeries(seriesId);
  if (s.seedCollectionId == null) throw new EnrichmentError("this series was not seeded from an IGDB collection", 400);
  const proposeMembers = propose ?? (await import("@/lib/catalog/collections")).proposeMembers;
  const seed = await proposeMembers(s.seedCollectionId);
  const entries = await prisma.seriesEntry.findMany({ where: { seriesId }, select: { igdbId: true } });
  const seen = JSON.parse(s.seenIgdbIds) as number[];
  const entryIds = entries.map((e) => e.igdbId).filter((x): x is number => x != null);
  const isNew = new Set(
    newSinceLastPrune(
      seed.candidates.map((c) => c.igdbId),
      seen,
      entryIds,
    ),
  );
  const known = new Set<number>([...seen, ...entryIds]);
  // A candidate whose collapsed variants are already known is not new either:
  // IGDB adding the Switch port of a game in the series is not a new entry.
  const fresh = seed.candidates.filter((c) => isNew.has(c.igdbId) && !c.variants.some((v) => known.has(v.igdbId)));
  const checkedAt = new Date();
  await prisma.series.update({ where: { id: seriesId }, data: { seedCheckedAt: checkedAt } });
  return { collection: seed.collection, fresh, skipped: seed.skipped, checkedAt };
}

export type { Series, SeriesEntry, SeriesCandidate, SeriesSeed };
export { MAX_ENTRIES_PER_SERIES, groupBySection, missingHref, newSinceLastPrune, parseMissing, seenIdsOf, slugify, uniqueSlug } from "./shape";
