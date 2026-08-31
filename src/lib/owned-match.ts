/**
 * One rule, used everywhere a list of IGDB ids has to be checked against the
 * shelf: the similar-games strip, and now series entries.
 *
 * It lives in its own module rather than in `collection.ts` because
 * `src/lib/series` needs it and `collection.ts` imports the series service —
 * a cycle otherwise. `collection.ts` re-exports it, so existing callers and
 * `collection.test.ts` are unaffected.
 */

/**
 * Owned games behind a list of IGDB ids. IGDB's lists usually point at a
 * game's main entry, while an owned cartridge links to its NES port — so an id
 * matches an owned game if it equals the owned catalog id, the owned row's
 * parent, or if the listed entry's own parent matches either.
 */
export function matchSimilarToOwned(similarIds: number[], similarParents: Map<number, number | null>, owned: { id: string; catalogGameId: number | null; parentIgdbId: number | null }[]): Map<number, string> {
  const byCatalog = new Map<number, string>();
  for (const o of owned) {
    if (o.catalogGameId != null) byCatalog.set(o.catalogGameId, o.id);
    if (o.parentIgdbId != null && !byCatalog.has(o.parentIgdbId)) byCatalog.set(o.parentIgdbId, o.id);
  }
  const out = new Map<number, string>();
  for (const sid of similarIds) {
    const hit = byCatalog.get(sid) ?? (similarParents.get(sid) != null ? byCatalog.get(similarParents.get(sid)!) : undefined);
    if (hit) out.set(sid, hit);
  }
  return out;
}
