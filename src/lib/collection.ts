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
};

export type SimilarGame = { igdbId: number; name: string; cover: string | null; year: number | null; ownedId: string | null; platformLabel: string | null };

export async function loadGame(id: string): Promise<GameDetail | null> {
  const g = await prisma.ownedGame.findUnique({ where: { id }, include: { catalogGame: true, facts: true } });
  if (!g) return null;
  const c = g.catalogGame;
  const shelf = (await loadShelf()).find((s) => s.id === id)!;
  const similarIds = c ? (JSON.parse(c.similarGameIds) as number[]) : [];
  const [similarCatalog, similarOwned] = await Promise.all([
    similarIds.length ? prisma.catalogGame.findMany({ where: { igdbId: { in: similarIds } } }) : Promise.resolve([]),
    similarIds.length ? prisma.ownedGame.findMany({ where: { catalogGameId: { in: similarIds } }, select: { id: true, catalogGameId: true, platform: true } }) : Promise.resolve([]),
  ]);
  const ownedByIgdb = new Map(similarOwned.map((o) => [o.catalogGameId!, o]));
  const similarGames: SimilarGame[] = similarIds
    .map((sid) => similarCatalog.find((x) => x.igdbId === sid))
    .filter((x): x is NonNullable<typeof x> => !!x)
    .map((x) => {
      const owned = ownedByIgdb.get(x.igdbId);
      return { igdbId: x.igdbId, name: x.name, cover: x.coverImageId, year: x.firstReleaseDate ? x.firstReleaseDate.getUTCFullYear() : null, ownedId: owned?.id ?? null, platformLabel: owned ? platformLabel(owned.platform) : (x.platformNames ? arr(x.platformNames).map((n) => platformBySlug(n)?.short ?? n)[0] ?? null : null) };
    })
    .sort((a, b) => Number(!!b.ownedId) - Number(!!a.ownedId));
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
  };
}
