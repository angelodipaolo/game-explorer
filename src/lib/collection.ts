import { prisma } from "@/lib/db";
import { matchSimilarToOwned } from "@/lib/owned-match";
import { playerSummary, resolvePlayerProfile, type PlayerProfile } from "@/lib/facts";
import { platformBySlug, platformLabel } from "@/lib/platforms";
import { resolveTags, type EffectiveTag } from "@/lib/tags";
import { codesFor, type GameCode } from "@/lib/codes/service";
import { mapsFor, type MapWithMarkers } from "@/lib/maps/service";
import { bookmarksFor, type GameBookmark } from "@/lib/bookmarks/service";
import { manualsFor, type ManualWithPages } from "@/lib/manuals/service";
import { entriesFor, type JournalEntry } from "@/lib/journal/service";
import { seriesForGame, type SeriesLink } from "@/lib/series/service";
import { NEVER_PLAYED, listOpenSessions, loadQueue, playStateFor, sessionsFor, type PlaySession, type PlayState, type PlayingCopy } from "@/lib/play/service";

/** The shelf-matching rule now lives in its own module; re-exported so every existing caller (and collection.test.ts) still finds it here. */
export { matchSimilarToOwned };

/**
 * View models the UI reads. Built server-side from local tables only, then
 * handed to the client once so filtering never waits on the network.
 */
export type ShelfGame = {
  id: string;
  title: string;
  /** Catalog name when linked, else the shelf title. */
  name: string;
  /** Primary platform (earliest era) — the one shown first. */
  platform: string;
  platformLabel: string;
  /** Every copy of this game, one per platform. A cross-gen PS4+PS5 purchase, or physical+digital, is ONE shelf entry. */
  copies: ShelfCopy[];
  /** Total copies across platforms. */
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
  /** Effective tags: IGDB genres/perspectives/themes ∪ yours ∪ agents − hidden. */
  tags: EffectiveTag[];
  /** IGDB ids of similar games (owned or not); resolved by the UI against the shelf. */
  similar: number[];
  summary: string | null;
  /**
   * Derived from the PlaySession log — never a column on OwnedGame. Filled in
   * by `loadShelf` from one `playStateFor` call for the whole shelf.
   */
  play: ShelfPlay;
};

/** `PlayState` without the open session id, which only the game page needs. */
export type ShelfPlay = { status: PlayState["status"]; runs: number; lastPlayedAt: Date | null };

export type ShelfCopy = { ownedId: string; platform: string; platformLabel: string; quantity: number };

/**
 * Play state for a grouped entry, across every copy of the game.
 *
 * `playing` if **any** copy has an open run; else `played` if any copy has a
 * finished one; else `never`. `runs` is the sum and `lastPlayedAt` the latest
 * of the two. The grouped card answers "am I in the middle of this game" — and
 * you are, whichever machine the cartridge is in.
 */
function rollUpPlay(a: ShelfPlay, b: ShelfPlay): ShelfPlay {
  return {
    status: a.status === "playing" || b.status === "playing" ? "playing" : a.status === "played" || b.status === "played" ? "played" : "never",
    runs: a.runs + b.runs,
    lastPlayedAt: !a.lastPlayedAt ? b.lastPlayedAt : !b.lastPlayedAt ? a.lastPlayedAt : a.lastPlayedAt > b.lastPlayedAt ? a.lastPlayedAt : b.lastPlayedAt,
  };
}

/**
 * Group owned rows into shelf entries: same IGDB game (or same shelf title
 * when unlinked) on several platforms collapses into one entry. Platforms are
 * ordered by era so the primary is the oldest system. Play state rolls up with
 * `rollUpPlay`.
 */
export function groupShelf(rows: ShelfGame[]): ShelfGame[] {
  const groups = new Map<string, ShelfGame>();
  for (const r of rows) {
    const key = r.igdbId != null ? `c:${r.igdbId}` : `t:${r.name.toLowerCase()}`;
    const g = groups.get(key);
    if (!g) {
      groups.set(key, { ...r, copies: [...r.copies] });
      continue;
    }
    for (const c of r.copies) {
      const existing = g.copies.find((x) => x.platform === c.platform);
      if (existing) existing.quantity += c.quantity;
      else g.copies.push(c);
    }
    g.quantity += r.quantity;
    g.play = rollUpPlay(g.play, r.play);
    // Facts may live on any copy; prefer the copy that knows more.
    if (g.players.tier === "unknown" && r.players.tier !== "unknown") g.players = r.players;
    if (g.playtime == null && r.playtime != null) g.playtime = r.playtime;
    for (const t of r.tags) if (!g.tags.some((x) => x.key === t.key)) g.tags = [...g.tags, t];
  }
  for (const g of groups.values()) {
    g.copies.sort((a, b) => (platformBySlug(a.platform)?.year ?? 9999) - (platformBySlug(b.platform)?.year ?? 9999));
    g.id = g.copies[0].ownedId;
    g.platform = g.copies[0].platform;
    g.platformLabel = g.copies[0].platformLabel;
  }
  return [...groups.values()];
}

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
  const rows = await loadOwnedRows();
  // ONE query for the play state of the entire shelf — never a per-game round
  // trip — merged per copy *before* grouping, so groupShelf can roll it up.
  const play = await playStateFor(rows.map((r) => r.id));
  for (const r of rows) {
    const s = play.get(r.id);
    if (s) r.play = { status: s.status, runs: s.runs, lastPlayedAt: s.lastPlayedAt };
  }
  return groupShelf(rows);
}

/**
 * One ShelfGame per owned row, before grouping. `play` is left at
 * `NEVER_PLAYED` here; `loadShelf` fills it in for every row in one query.
 */
export async function loadOwnedRows(): Promise<ShelfGame[]> {
  const owned = await prisma.ownedGame.findMany({ include: { catalogGame: true, facts: true, tags: true }, orderBy: { title: "asc" } });
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
      copies: [{ ownedId: g.id, platform: g.platform, platformLabel: platformLabel(g.platform), quantity: g.quantity }],
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
      tags: resolveTags({ genres: c ? arr(c.genres) : [], perspectives: c ? arr(c.playerPerspectives) : [], themes: c ? arr(c.themes) : [] }, g.tags),
      similar: c ? (JSON.parse(c.similarGameIds) as number[]) : [],
      summary: c?.summary ?? null,
      play: { ...NEVER_PLAYED },
    };
  });
}

/** One row of the main menu's platform list. */
export type PlatformCount = { slug: string; label: string; count: number };

/**
 * The platform list the global menu draws, counted in the database rather than
 * from a loaded shelf: since GAMEEXPLOR-0018 the drawer is on every page, and
 * most of them have no reason to pull the whole collection into memory.
 *
 * The numbers have to agree with the shelf's own or the menu lies, so they are
 * computed the way `facets()` and `groupShelf` compute them. A platform's
 * count is its *copies* — one per platform per grouped game, so two rows of
 * the same cartridge on the same system count once, exactly as `groupShelf`
 * merges them. `total` is the number of grouped entries, which is the
 * "All N games" the shelf prints; grouping by `catalogGameId` partitions the
 * rows identically to `groupShelf`'s `igdbId`, since the two are the same key.
 */
export async function platformCounts(): Promise<{ platforms: PlatformCount[]; total: number }> {
  // No `catalogGame` join: the only place a catalog name could be read is the
  // branch where `catalogGameId` is null, and there the relation is null too —
  // so `name` there is always the shelf title, which is exactly what
  // `groupShelf` falls back to.
  const rows = await prisma.ownedGame.findMany({ select: { platform: true, catalogGameId: true, title: true } });
  const groups = new Set<string>();
  const copies = new Set<string>();
  const counts = new Map<string, number>();
  for (const r of rows) {
    const key = r.catalogGameId != null ? `c:${r.catalogGameId}` : `t:${r.title.toLowerCase()}`;
    groups.add(key);
    const copy = `${key}|${r.platform}`;
    if (copies.has(copy)) continue;
    copies.add(copy);
    counts.set(r.platform, (counts.get(r.platform) ?? 0) + 1);
  }
  return {
    // Biggest shelf first, then alphabetical: `findMany` has no order here, and
    // a menu whose rows swap places between page loads is unusable.
    platforms: [...counts].map(([slug, count]) => ({ slug, label: platformLabel(slug), count })).sort((a, b) => b.count - a.count || a.slug.localeCompare(b.slug)),
    total: groups.size,
  };
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
  /** IGDB tags hidden on this game, so they can be shown again. */
  hiddenTags: { key: string; tag: string }[];
  /** Passwords and cheat codes for this copy, in display order. */
  codes: GameCode[];
  /** Interactive maps for this copy, with markers, in display order. */
  maps: MapWithMarkers[];
  /** Links kept for this copy — guides, wikis, longplays — grouped by kind. */
  bookmarks: GameBookmark[];
  /** Scanned manuals for this copy, with their pages in reading order. */
  manuals: ManualWithPages[];
  /** Runs at this copy, newest first. Play state is derived from these, never stored. */
  sessions: PlaySession[];
  /** Notes and photos for this copy, newest first. */
  journal: JournalEntry[];
  /** Whether this copy is in the one "up next" queue. A copy with an open run never is. */
  queued: boolean;
  /** The series this game is part of — "Part of Final Fantasy →". Empty for an unlinked cartridge. */
  series: SeriesLink[];
};

export type SimilarGame = { igdbId: number; name: string; cover: string | null; year: number | null; ownedId: string | null; platformLabel: string | null };

/**
 * "More like this" by tag overlap, using the effective tags (IGDB's plus yours
 * and an agent's, minus hidden) so tagging shapes what shows up here.
 */
export function relatedOnShelf(game: ShelfGame, shelf: ShelfGame[], n = 8): ShelfGame[] {
  const tags = new Set(game.tags.map((t) => t.key));
  if (!tags.size) return [];
  const genreKeys = new Set(game.genres.map((g) => g.toLowerCase()));
  return shelf
    .filter((g) => g.id !== game.id)
    .map((g) => {
      const overlap = g.tags.filter((t) => tags.has(t.key)).length;
      // A shared non-IGDB tag (yours/agent) is a strong signal: it was chosen, not inferred.
      const chosen = g.tags.filter((t) => t.source !== "igdb" && tags.has(t.key)).length;
      const genreHit = g.genres.some((t) => genreKeys.has(t.toLowerCase())) ? 1 : 0;
      return { g, score: overlap + chosen * 2 + genreHit * 2 + (g.copies.some((c) => game.copies.some((d) => d.platform === c.platform)) ? 0.5 : 0) };
    })
    .filter((x) => x.score >= 3)
    .sort((a, b) => b.score - a.score || (b.g.rating ?? 0) - (a.g.rating ?? 0))
    .slice(0, n)
    .map((x) => x.g);
}

export async function loadGame(id: string): Promise<GameDetail | null> {
  const g = await prisma.ownedGame.findUnique({ where: { id }, include: { catalogGame: true, facts: true, tags: true } });
  if (!g) return null;
  const c = g.catalogGame;
  const allShelf = await loadShelf();
  const shelf = allShelf.find((s) => s.copies.some((c) => c.ownedId === id))!;
  const similarIds = c ? (JSON.parse(c.similarGameIds) as number[]) : [];
  const [similarCatalog, ownedLinks, codes, maps, bookmarks, manuals, sessions, journal, queueEntry, series] = await Promise.all([
    similarIds.length ? prisma.catalogGame.findMany({ where: { igdbId: { in: similarIds } } }) : Promise.resolve([]),
    prisma.ownedGame.findMany({ where: { catalogGameId: { not: null } }, select: { id: true, catalogGameId: true, platform: true, catalogGame: { select: { parentIgdbId: true } } } }),
    codesFor(id),
    mapsFor(id),
    bookmarksFor(id),
    manualsFor(id),
    sessionsFor(id),
    entriesFor(id),
    prisma.queueEntry.findUnique({ where: { ownedGameId: id }, select: { id: true } }),
    // Constant queries, not one per series: `seriesForGame` looks the id up
    // directly and rides along in this same round of parallel work.
    seriesForGame({ igdbId: c?.igdbId ?? null, parentIgdbId: c?.parentIgdbId ?? null }),
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
  const related = relatedOnShelf(shelf, allShelf, 12).filter((r) => !seenOwned.has(r.id));
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
    hiddenTags: g.tags.filter((t) => t.source === "igdb-hide").map((t) => ({ key: t.key, tag: t.tag })),
    codes,
    maps,
    bookmarks,
    manuals,
    sessions,
    journal,
    queued: queueEntry != null,
    series,
  };
}

/* ----------------------------------------------------------------- /playing */

export type PlayingGame = { ownedGameId: string; name: string; cover: string | null; platformLabel: string };
/** An open run, with the last thing written during it as the "where I left off" line. */
export type InProgressRow = PlayingGame & { sessionId: string; startedAt: Date; note: string | null; lastEntry: { title: string | null; body: string | null; occurredAt: Date } | null };
export type QueuedRow = PlayingGame & { position: number; note: string | null };

/**
 * The two lists behind `/playing`: runs in progress, and the ordered queue.
 * Disjoint by construction — starting a run dequeues the copy in the same
 * transaction (see src/lib/play/service.ts).
 */
export async function loadPlaying(): Promise<{ inProgress: InProgressRow[]; upNext: QueuedRow[] }> {
  // Both queries already carry the copy and its catalog entry, so there is no
  // third pass over OwnedGame here — the rows below are built from what they
  // returned.
  const [open, queue] = await Promise.all([listOpenSessions(), loadQueue()]);
  if (!open.length && !queue.length) return { inProgress: [], upNext: [] };
  // Only entries written during one of the open runs: a note from a
  // playthrough three years ago is not where you left off this time.
  const entries = open.length
    ? await prisma.journalEntry.findMany({ where: { sessionId: { in: open.map((s) => s.id) } }, orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }] })
    : [];
  const game = (o: PlayingCopy): PlayingGame => ({
    ownedGameId: o.id,
    name: o.catalogGame?.name ?? o.title,
    cover: o.catalogGame?.coverImageId ?? null,
    platformLabel: platformLabel(o.platform),
  });
  return {
    inProgress: open.map((s) => {
      const e = entries.find((x) => x.sessionId === s.id);
      return { ...game(s.ownedGame), sessionId: s.id, startedAt: s.startedAt, note: s.note, lastEntry: e ? { title: e.title, body: e.body, occurredAt: e.occurredAt } : null };
    }),
    upNext: queue.map((q) => ({ ...game(q.ownedGame), position: q.position, note: q.note })),
  };
}
