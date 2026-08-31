/**
 * The catalog module: everything the app knows about IGDB comes through
 * here. Import and enrichment code depend on this port, never on igdb/.
 */
import { igdbApi } from "@/lib/igdb";
import { platformBySlug } from "@/lib/platforms";
import { collectionsForGame, fetchCollection, proposeMembers, type CatalogCollection, type SeriesSeed } from "./collections";
import { findCandidates, type MatchCandidate } from "./match";
import { syncCatalog, type SyncReport } from "./sync";

export type CatalogPort = {
  /** Ranked candidates for a shelf title on a platform slug. */
  candidates(title: string, platformSlug: string | null): Promise<MatchCandidate[]>;
  /** Make sure these IGDB ids exist locally in full detail. */
  sync(ids: number[]): Promise<SyncReport>;
  /** An IGDB collection (series) with its member ids. Null when there is no such collection. */
  collection(id: number): Promise<CatalogCollection | null>;
  /** The collections a game belongs to — how the owner finds a collection id to seed from. */
  collectionsForGame(igdbId: number): Promise<CatalogCollection[]>;
  /** A pruneable candidate list for a collection: hydrated, ports collapsed, ownership resolved. */
  proposeMembers(collectionId: number): Promise<SeriesSeed>;
};

export function liveCatalog(): CatalogPort {
  const api = igdbApi();
  return {
    candidates(title, platformSlug) {
      const platform = platformSlug ? platformBySlug(platformSlug) : null;
      return findCandidates(title, platform ? [platform.igdbId] : undefined, (term, p) => api.search(term, p, 10));
    },
    sync(ids) {
      return syncCatalog(ids, api);
    },
    collection(id) {
      return fetchCollection(id, api);
    },
    collectionsForGame(igdbId) {
      return collectionsForGame(igdbId, api);
    },
    proposeMembers(collectionId) {
      return proposeMembers(collectionId, api);
    },
  };
}

export { decide, findCandidates, type MatchCandidate, type MatchVerdict } from "./match";
export { normalizeTitle, titleVariants } from "./normalize";
export { syncCatalog } from "./sync";
export { collectionsForGame, fetchCollection, fetchCollections, proposeMembers, type CatalogCollection, type SeriesCandidate, type SeriesSeed } from "./collections";
