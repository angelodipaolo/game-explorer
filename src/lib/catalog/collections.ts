import { prisma } from "@/lib/db";
import { EnrichmentError } from "@/lib/enrichment/service";
import { igdbApi, type IgdbApi } from "@/lib/igdb";
import { matchSimilarToOwned } from "@/lib/owned-match";
import { platformLabel } from "@/lib/platforms";
import { syncCatalog } from "./sync";

/**
 * IGDB collections — what IGDB calls a series — and the candidate list a
 * `Series` is seeded from.
 *
 * This is the only place that reads /v4/collections, and it lives inside
 * `src/lib/catalog` because nothing outside catalog and igdb may touch the
 * IGDB client (`boundary.test.ts`). `src/lib/series` consumes what is here.
 *
 * IGDB proposes, a person disposes. A collection is unusable as a series page
 * on its own — collection 39 "Final Fantasy" has 191 members, and "Mario
 * Party" pads a ~20-game series to 44 with individual minigames that the
 * `game_type` rule provably does not remove. So this module produces
 * *candidates*, and nothing here writes a Series.
 */

export type CatalogCollection = {
  id: number;
  name: string;
  slug: string | null;
  /** Every member id IGDB lists, before the game_type rule. */
  gameIds: number[];
};

/** One proposed member, already hydrated into the local catalog. */
export type SeriesCandidate = {
  igdbId: number;
  name: string;
  cover: string | null;
  year: number | null;
  /**
   * Ports and remakes of this game that were also in the collection, folded
   * into it through `parentIgdbId`. A series list wants "Final Fantasy VII",
   * not it plus its four re-releases.
   */
  variants: { igdbId: number; name: string; year: number | null }[];
  /** The owned copy, when there is one — resolved by the shelf's own rule. */
  ownedId: string | null;
  platformLabel: string | null;
};

export type SeriesSeed = {
  collection: CatalogCollection;
  /** Ordered by first release date, so `position` can be seeded from the index. */
  candidates: SeriesCandidate[];
  /**
   * Member ids IGDB did not return full detail for. Almost always the
   * `game_type` rule doing its job (DLC, episodes, packs, romhacks): every
   * /games query carries it, so those ids come back empty rather than as rows.
   */
  skipped: number[];
};

function toCollection(c: { id: number; name: string; slug?: string; games?: number[] }): CatalogCollection {
  return { id: c.id, name: c.name, slug: c.slug ?? null, gameIds: c.games ?? [] };
}

/** One collection by id, with its member list. Null when IGDB has no such collection. */
export async function fetchCollection(id: number, api: IgdbApi = igdbApi()): Promise<CatalogCollection | null> {
  const [c] = await api.collections([id]);
  return c ? toCollection(c) : null;
}

/** Several at once — one request per 100. */
export async function fetchCollections(ids: number[], api: IgdbApi = igdbApi()): Promise<CatalogCollection[]> {
  if (!ids.length) return [];
  return (await api.collections(ids)).map(toCollection);
}

/**
 * The collections a game belongs to — the discovery path: you pick a game you
 * own and IGDB says which series it is in.
 *
 * Prefers the ids cached on the local `CatalogGame` row (that is what adding
 * `collections` to `GAME_FIELDS` bought), and falls back to IGDB's reverse
 * lookup for a game that has not been synced since. Either way one request
 * fetches the names.
 */
export async function collectionsForGame(igdbId: number, api: IgdbApi = igdbApi()): Promise<CatalogCollection[]> {
  const row = await prisma.catalogGame.findUnique({ where: { igdbId }, select: { collections: true } });
  const cached = row ? (JSON.parse(row.collections) as number[]) : [];
  if (cached.length) return fetchCollections(cached, api);
  return (await api.collectionsByGame(igdbId)).map(toCollection);
}

const yearOf = (d: Date | null) => (d ? d.getUTCFullYear() : null);
/** Undated entries sort last, then alphabetically — never in the middle of the run. */
const byRelease = (a: { firstReleaseDate: Date | null; name: string }, b: { firstReleaseDate: Date | null; name: string }) =>
  (a.firstReleaseDate?.getTime() ?? Number.MAX_SAFE_INTEGER) - (b.firstReleaseDate?.getTime() ?? Number.MAX_SAFE_INTEGER) || a.name.localeCompare(b.name);

/**
 * Turn an IGDB collection id into a candidate list to prune.
 *
 * Every member id is hydrated with `syncCatalog(..., { withStubs: false })`, so
 * a game nobody owns still gets a real row with a cover. Stubs are off on
 * purpose: they are the *similar games* of everything fetched, which is dozens
 * of unrelated rows sprayed into `CatalogGame` on every preview and every
 * "check for new entries" — a seed only ever needs the members themselves.
 *
 * The ids that query does not return are reported in `skipped` rather than
 * guessed at: a /games query always carries the `game_type` filter, so a DLC or
 * an episode is simply absent from the response, and treating absence as
 * failure would be wrong.
 */
export async function proposeMembers(collectionId: number, api: IgdbApi = igdbApi()): Promise<SeriesSeed> {
  const collection = await fetchCollection(collectionId, api);
  if (!collection) throw new EnrichmentError(`IGDB has no collection ${collectionId}`, 404);
  if (!collection.gameIds.length) return { collection, candidates: [], skipped: [] };

  const report = await syncCatalog(collection.gameIds, api, { withStubs: false });
  const fetched = new Set(report.fetched);
  const skipped = collection.gameIds.filter((id) => !fetched.has(id));

  const rows = await prisma.catalogGame.findMany({ where: { igdbId: { in: [...fetched] } } });
  const owned = await prisma.ownedGame.findMany({
    where: { catalogGameId: { not: null } },
    select: { id: true, catalogGameId: true, platform: true, catalogGame: { select: { parentIgdbId: true } } },
  });

  // Collapse ports and remakes into the entry they descend from, but only when
  // that parent is itself in this collection — a port whose original is not in
  // the series is an entry in its own right.
  //
  // Chains are followed to their root inside the collection: a remaster of a
  // remake (A → B → C, all three listed) is one group under A. Keying on the
  // immediate parent alone would split it in two and could make the middle
  // link a primary. The `walked` guard is for IGDB data that points in a
  // circle; it stops rather than looping.
  const parentOf = new Map(rows.map((r) => [r.igdbId, r.parentIgdbId]));
  const rootOf = (igdbId: number): number => {
    let current = igdbId;
    const walked = new Set<number>([current]);
    for (;;) {
      const parent = parentOf.get(current);
      if (parent == null || !parentOf.has(parent) || walked.has(parent)) return current;
      walked.add(parent);
      current = parent;
    }
  };

  const groups = new Map<number, typeof rows>();
  for (const r of rows) {
    const key = rootOf(r.igdbId);
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }

  const primaries = [...groups.entries()].map(([key, members]) => {
    const sorted = [...members].sort(byRelease);
    const primary = members.find((m) => m.igdbId === key) ?? sorted[0];
    return { primary, variants: sorted.filter((m) => m.igdbId !== primary.igdbId) };
  });
  primaries.sort((a, b) => byRelease(a.primary, b.primary));

  const ownedMatches = matchSimilarToOwned(
    primaries.flatMap(({ primary, variants }) => [primary.igdbId, ...variants.map((v) => v.igdbId)]),
    parentOf,
    owned.map((o) => ({ id: o.id, catalogGameId: o.catalogGameId, parentIgdbId: o.catalogGame?.parentIgdbId ?? null })),
  );
  const platformOf = new Map(owned.map((o) => [o.id, o.platform]));

  const candidates: SeriesCandidate[] = primaries.map(({ primary, variants }) => {
    // A variant can be the copy actually on the shelf (the NES port of an
    // arcade original), so ownership looks through the whole group.
    const ownedId = ownedMatches.get(primary.igdbId) ?? variants.map((v) => ownedMatches.get(v.igdbId)).find(Boolean) ?? null;
    return {
      igdbId: primary.igdbId,
      name: primary.name,
      cover: primary.coverImageId,
      year: yearOf(primary.firstReleaseDate),
      variants: variants.map((v) => ({ igdbId: v.igdbId, name: v.name, year: yearOf(v.firstReleaseDate) })),
      ownedId,
      platformLabel: ownedId ? platformLabel(platformOf.get(ownedId)!) : null,
    };
  });

  return { collection, candidates, skipped };
}
