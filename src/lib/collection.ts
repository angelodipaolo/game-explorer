import { prisma } from "@/lib/db";
import { playerSummary, resolvePlayerProfile, type PlayerProfile } from "@/lib/facts";
import { platformBySlug, platformLabel } from "@/lib/platforms";

/**
 * View models the UI reads. Built server-side from local tables only, then
 * handed to the client once so filtering never waits on the network.
 */
export type ShelfGame = {
  id: string;
  title: string;
  /** Catalog name when linked, else the shelf title. */
  name: string;
  platform: string;
  platformLabel: string;
  quantity: number;
  igdbId: number | null;
  cover: string | null;
  year: number | null;
  genres: string[];
  themes: string[];
  perspectives: string[];
  rating: number | null;
  /** Minutes to beat "normally", null when unknown. */
  playtime: number | null;
  players: {
    label: string;
    tier: "exact" | "mode" | "unknown";
    max: number | null;
    coop: boolean | null;
    multiplayer: boolean | null;
    single: boolean | null;
    simultaneous: boolean | null;
    /** True when any player fact came from a manual/agent source. */
    verified: boolean;
  };
  hasScreenshots: boolean;
  /** IGDB ids of similar games (owned or not); resolved by the UI against the shelf. */
  similar: number[];
  summary: string | null;
};

export function profileToShelfPlayers(p: PlayerProfile): ShelfGame["players"] {
  const summary = playerSummary(p);
  const verified = [p.coop, p.maxPlayers, p.simultaneousPlay, p.multiplayer, p.singlePlayer].some((f) => f.source === "manual" || f.source === "agent");
  return {
    label: summary.label,
    tier: summary.tier,
    max: p.maxPlayers.value,
    coop: p.coop.value,
    multiplayer: p.multiplayer.value,
    single: p.singlePlayer.value,
    simultaneous: p.simultaneousPlay.value,
    verified,
  };
}

function arr(json: string): string[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export async function loadShelf(): Promise<ShelfGame[]> {
  const owned = await prisma.ownedGame.findMany({ include: { catalogGame: true, facts: true }, orderBy: { title: "asc" } });
  return owned.map((g) => {
    const c = g.catalogGame;
    const profile = resolvePlayerProfile(
      c ? { gameModes: JSON.parse(c.gameModes), mpOfflineMax: c.mpOfflineMax, mpOfflineCoopMax: c.mpOfflineCoopMax, mpOfflineCoop: c.mpOfflineCoop, mpSplitscreen: c.mpSplitscreen, mpCampaignCoop: c.mpCampaignCoop, ttbNormally: c.ttbNormally } : null,
      g.facts,
    );
    const playtimeFact = profile.playtimeMinutes;
    return {
      id: g.id,
      title: g.title,
      name: c?.name ?? g.title,
      platform: g.platform,
      platformLabel: platformLabel(g.platform),
      quantity: g.quantity,
      igdbId: c?.igdbId ?? null,
      cover: c?.coverImageId ?? null,
      year: c?.firstReleaseDate ? c.firstReleaseDate.getUTCFullYear() : null,
      genres: c ? arr(c.genres) : [],
      themes: c ? arr(c.themes) : [],
      perspectives: c ? arr(c.playerPerspectives) : [],
      rating: c?.rating != null ? Math.round(c.rating) : null,
      playtime: playtimeFact.value,
      players: profileToShelfPlayers(profile),
      hasScreenshots: c ? arr(c.screenshots).length > 0 : false,
      similar: c ? (JSON.parse(c.similarGameIds) as number[]) : [],
      summary: c?.summary ?? null,
    };
  });
}

export type GameDetail = ShelfGame & {
  storyline: string | null;
  developers: string[];
  publishers: string[];
  keywords: string[];
  platformNames: string[];
  screenshots: { imageId: string; width: number | null; height: number | null }[];
  ratingCount: number | null;
  playtimeRange: { hastily: number | null; normally: number | null; completely: number | null };
  profile: PlayerProfile;
  completeness: string | null;
  condition: string | null;
  notes: string | null;
  matchConfidence: number | null;
  matchSource: string | null;
  similarGames: SimilarGame[];
  /** Genre-overlap fallback when IGDB's similar list finds nothing owned. */
  related: ShelfGame[];
};

export type SimilarGame = { igdbId: number; name: string; cover: string | null; year: number | null; ownedId: string | null; platformLabel: string | null };

/**
 * Owned games that IGDB calls similar. IGDB's similar_games usually point at
 * a game's main entry, while an owned cartridge links to its NES port — so a
 * similar id matches an owned game if it equals the owned catalog id, the
 * owned row's parent, or if the similar entry's own parent matches either.
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

/** Fallback "more like this": owned games sharing genres/themes/perspective, ranked by overlap. */
export function relatedOnShelf(game: ShelfGame, shelf: ShelfGame[], n = 8): ShelfGame[] {
  const tags = new Set([...game.genres, ...game.themes, ...game.perspectives]);
  if (!tags.size) return [];
  return shelf
    .filter((g) => g.id !== game.id)
    .map((g) => {
      const overlap = [...g.genres, ...g.themes, ...g.perspectives].filter((t) => tags.has(t)).length;
      const genreHit = g.genres.some((t) => game.genres.includes(t)) ? 1 : 0;
      return { g, score: overlap + genreHit * 2 + (g.platform === game.platform ? 0.5 : 0) };
    })
    .filter((x) => x.score >= 3)
    .sort((a, b) => b.score - a.score || (b.g.rating ?? 0) - (a.g.rating ?? 0))
    .slice(0, n)
    .map((x) => x.g);
}

export async function loadGame(id: string): Promise<GameDetail | null> {
  const g = await prisma.ownedGame.findUnique({ where: { id }, include: { catalogGame: true, facts: true } });
  if (!g) return null;
  const c = g.catalogGame;
  const allShelf = await loadShelf();
  const shelf = allShelf.find((s) => s.id === id)!;
  const similarIds = c ? (JSON.parse(c.similarGameIds) as number[]) : [];
  const [similarCatalog, ownedLinks] = await Promise.all([
    similarIds.length ? prisma.catalogGame.findMany({ where: { igdbId: { in: similarIds } } }) : Promise.resolve([]),
    prisma.ownedGame.findMany({ where: { catalogGameId: { not: null } }, select: { id: true, catalogGameId: true, platform: true, catalogGame: { select: { parentIgdbId: true } } } }),
  ]);
  const ownedMatches = matchSimilarToOwned(
    similarIds,
    new Map(similarCatalog.map((x) => [x.igdbId, x.parentIgdbId])),
    ownedLinks.map((o) => ({ id: o.id, catalogGameId: o.catalogGameId, parentIgdbId: o.catalogGame?.parentIgdbId ?? null })),
  );
  const platformOfOwned = new Map(ownedLinks.map((o) => [o.id, o.platform]));
  const seenOwned = new Set<string>();
  const similarGames: SimilarGame[] = [];
  for (const sid of similarIds) {
    const x = similarCatalog.find((c) => c.igdbId === sid);
    if (!x) continue;
    const ownedId = ownedMatches.get(x.igdbId) ?? null;
    if (ownedId) {
      if (ownedId === id || seenOwned.has(ownedId)) continue;
      seenOwned.add(ownedId);
    }
    similarGames.push({
      igdbId: x.igdbId,
      name: x.name,
      cover: x.coverImageId,
      year: x.firstReleaseDate ? x.firstReleaseDate.getUTCFullYear() : null,
      ownedId,
      platformLabel: ownedId ? platformLabel(platformOfOwned.get(ownedId)!) : (arr(x.platformNames).map((n) => platformBySlug(n)?.short ?? n)[0] ?? null),
    });
  }
  similarGames.sort((a, b) => Number(!!b.ownedId) - Number(!!a.ownedId));
  const related = relatedOnShelf(shelf, allShelf).filter((r) => !seenOwned.has(r.id));
  const profile = resolvePlayerProfile(
    c ? { gameModes: JSON.parse(c.gameModes), mpOfflineMax: c.mpOfflineMax, mpOfflineCoopMax: c.mpOfflineCoopMax, mpOfflineCoop: c.mpOfflineCoop, mpSplitscreen: c.mpSplitscreen, mpCampaignCoop: c.mpCampaignCoop, ttbNormally: c.ttbNormally } : null,
    g.facts,
  );
  return {
    ...shelf,
    storyline: c?.storyline ?? null,
    developers: c ? arr(c.developers) : [],
    publishers: c ? arr(c.publishers) : [],
    keywords: c ? arr(c.keywords) : [],
    platformNames: c ? arr(c.platformNames) : [],
    screenshots: c ? (JSON.parse(c.screenshots) as GameDetail["screenshots"]) : [],
    ratingCount: c?.ratingCount ?? null,
    playtimeRange: { hastily: c?.ttbHastily ?? null, normally: c?.ttbNormally ?? null, completely: c?.ttbCompletely ?? null },
    profile,
    completeness: g.completeness,
    condition: g.condition,
    notes: g.notes,
    matchConfidence: g.matchConfidence,
    matchSource: g.matchSource,
    similarGames,
    related,
  };
}
