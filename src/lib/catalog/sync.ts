import { prisma } from "@/lib/db";
import { igdbApi, type IgdbApi, type IgdbGame, type IgdbSearchHit } from "@/lib/igdb";

/**
 * Pulls IGDB detail for a set of game ids into CatalogGame, plus stubs for
 * every similar game so the "similar" section can show names and covers of
 * games Angelo does not own.
 *
 * A port's own entry is often thinner than the original it was ported from
 * (no screenshots, no summary). When a game has a parent, missing fields are
 * filled from the parent — the catalog row then describes the cartridge with
 * the original's richness.
 */

export type SyncReport = { full: number; stubs: number; requests: number };

function json<T>(value: T): string {
  return JSON.stringify(value ?? null);
}

function names(list: { name: string }[] | undefined): string[] {
  return (list ?? []).map((x) => x.name);
}

/** Absent and 0 both mean unknown for IGDB's optional counts. */
function count(n: number | undefined): number | null {
  return n && n > 0 ? n : null;
}

function bool(b: boolean | undefined): boolean | null {
  return b == null ? null : b;
}

function fill<T>(own: T | undefined | null, parent: T | undefined | null): T | null {
  if (own == null) return parent ?? null;
  if (Array.isArray(own) && own.length === 0 && Array.isArray(parent) && parent.length) return parent;
  return own;
}

export function toCatalogRow(game: IgdbGame, parent: IgdbGame | null, ttb: { hastily?: number; normally?: number; completely?: number } | null) {
  const p = parent ?? undefined;
  const mp = game.multiplayer_modes?.[0] ?? p?.multiplayer_modes?.[0];
  const dev = (game.involved_companies ?? []).filter((c) => c.developer).map((c) => c.company.name);
  const pub = (game.involved_companies ?? []).filter((c) => c.publisher).map((c) => c.company.name);
  const pdev = (p?.involved_companies ?? []).filter((c) => c.developer).map((c) => c.company.name);
  const ppub = (p?.involved_companies ?? []).filter((c) => c.publisher).map((c) => c.company.name);
  return {
    igdbId: game.id,
    name: game.name,
    slug: game.slug ?? String(game.id),
    detail: "full",
    summary: fill(game.summary, p?.summary),
    storyline: fill(game.storyline, p?.storyline),
    firstReleaseDate: game.first_release_date ? new Date(game.first_release_date * 1000) : p?.first_release_date ? new Date(p.first_release_date * 1000) : null,
    coverImageId: game.cover?.image_id ?? p?.cover?.image_id ?? null,
    coverWidth: game.cover?.width ?? p?.cover?.width ?? null,
    coverHeight: game.cover?.height ?? p?.cover?.height ?? null,
    rating: fill(game.rating, p?.rating),
    ratingCount: fill(game.rating_count, p?.rating_count),
    platformNames: json(names(game.platforms)),
    platformIds: json((game.platforms ?? []).map((x) => x.id)),
    genres: json(fill(names(game.genres), names(p?.genres))),
    themes: json(fill(names(game.themes), names(p?.themes))),
    playerPerspectives: json(fill(names(game.player_perspectives), names(p?.player_perspectives))),
    keywords: json(fill(names(game.keywords), names(p?.keywords))),
    developers: json(fill(dev, pdev)),
    publishers: json(fill(pub, ppub)),
    gameModes: json(fill(game.game_modes ?? [], p?.game_modes ?? [])),
    screenshots: json(
      fill(
        (game.screenshots ?? []).map((s) => ({ imageId: s.image_id, width: s.width ?? null, height: s.height ?? null })),
        (p?.screenshots ?? []).map((s) => ({ imageId: s.image_id, width: s.width ?? null, height: s.height ?? null })),
      ),
    ),
    similarGameIds: json(fill(game.similar_games ?? [], p?.similar_games ?? [])),
    mpOfflineMax: count(mp?.offlinemax),
    mpOfflineCoopMax: count(mp?.offlinecoopmax),
    mpOfflineCoop: bool(mp?.offlinecoop),
    mpSplitscreen: bool(mp?.splitscreen),
    mpCampaignCoop: bool(mp?.campaigncoop),
    mpDropIn: bool(mp?.dropin),
    mpLanCoop: bool(mp?.lancoop),
    mpOnlineCoop: bool(mp?.onlinecoop),
    mpOnlineMax: count(mp?.onlinemax),
    ttbNormally: ttb?.normally ? Math.round(ttb.normally / 60) : null,
    ttbHastily: ttb?.hastily ? Math.round(ttb.hastily / 60) : null,
    ttbCompletely: ttb?.completely ? Math.round(ttb.completely / 60) : null,
    fetchedAt: new Date(),
  };
}

export function toStubRow(hit: IgdbSearchHit) {
  return {
    igdbId: hit.id,
    name: hit.name,
    slug: hit.slug ?? String(hit.id),
    detail: "stub",
    firstReleaseDate: hit.first_release_date ? new Date(hit.first_release_date * 1000) : null,
    coverImageId: hit.cover?.image_id ?? null,
    coverWidth: hit.cover?.width ?? null,
    coverHeight: hit.cover?.height ?? null,
    platformNames: json(names(hit.platforms)),
    platformIds: json((hit.platforms ?? []).map((x) => x.id)),
    fetchedAt: new Date(),
  };
}

/** Fetch full detail for `ids` and upsert; then make sure every similar game exists at least as a stub. */
export async function syncCatalog(ids: number[], api: IgdbApi = igdbApi(), opts: { withStubs?: boolean } = {}): Promise<SyncReport> {
  const withStubs = opts.withStubs ?? true;
  const wanted = [...new Set(ids)];
  if (!wanted.length) return { full: 0, stubs: 0, requests: 0 };
  let requests = 0;

  const games = await api.games(wanted);
  requests++;
  const parentIds = games.map((g) => g.parent_game ?? g.version_parent).filter((x): x is number => x != null && !wanted.includes(x));
  const parents = parentIds.length ? await api.games(parentIds) : [];
  if (parentIds.length) requests++;
  const parentById = new Map(parents.map((p) => [p.id, p]));
  const ownById = new Map(games.map((g) => [g.id, g]));

  const ttbs = await api.timeToBeat([...wanted, ...parentIds]);
  requests++;
  const ttbById = new Map(ttbs.map((t) => [t.game_id, t]));

  const similar = new Set<number>();
  for (const game of games) {
    const parentId = game.parent_game ?? game.version_parent;
    const parent = parentId != null ? (parentById.get(parentId) ?? ownById.get(parentId) ?? null) : null;
    const ttb = ttbById.get(game.id) ?? (parentId != null ? ttbById.get(parentId) : undefined) ?? null;
    const row = toCatalogRow(game, parent, ttb);
    await prisma.catalogGame.upsert({ where: { igdbId: game.id }, create: row, update: row });
    for (const id of JSON.parse(row.similarGameIds) as number[]) similar.add(id);
  }

  let stubs = 0;
  if (withStubs && similar.size) {
    const existing = await prisma.catalogGame.findMany({ where: { igdbId: { in: [...similar] } }, select: { igdbId: true } });
    const have = new Set(existing.map((e) => e.igdbId));
    const missing = [...similar].filter((id) => !have.has(id));
    if (missing.length) {
      const hits = await api.stubs(missing);
      requests++;
      for (const hit of hits) {
        const row = toStubRow(hit);
        await prisma.catalogGame.upsert({ where: { igdbId: hit.id }, create: row, update: {} });
        stubs++;
      }
    }
  }
  return { full: games.length, stubs, requests };
}
