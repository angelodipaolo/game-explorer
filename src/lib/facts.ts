/**
 * Player facts, resolved from three sources with fixed precedence:
 *   manual  — the owner set it by hand; never overwritten
 *   agent   — an enrichment run found it, with a cited source
 *   catalog — IGDB, in two tiers: game_modes (co-op yes/no) and
 *             multiplayer_modes (exact counts)
 *   derived — computed from other facts (simultaneousPlay from offlinecoop)
 *
 * Co-op is three fields, not one, because IGDB answers them separately:
 *   coop        — cooperative play at all, KIND UNKNOWN. `game_modes` id 3 is
 *                 "Co-Operative"; it says nothing about a couch. Hand-set and
 *                 agent `coop` facts mean this too.
 *   localCoop   — a couch: `multiplayer_modes.offlinecoop`/`offlinecoopmax`,
 *                 or split screen on a game that is cooperative.
 *   onlineCoop  — remote: `multiplayer_modes.onlinecoop`.
 * Only kind-specific evidence may set a kind. Never infer "local" from the
 * bare co-op tag: Bloodborne, Destiny and DOOM carry it and none of them is a
 * couch game. `src/lib/players.ts` turns the resolved profile into the words a
 * person reads.
 *
 * Every resolved value carries where it came from so the UI can show
 * "verified" vs "from IGDB" vs "unknown".
 */

export const FACT_FIELDS = [
  "singlePlayer",
  "multiplayer",
  "coop",
  "localCoop",
  "onlineCoop",
  "splitscreen",
  "maxPlayers",
  "coopMaxPlayers",
  "simultaneousPlay",
  "playtimeMinutes",
] as const;
export type FactField = (typeof FACT_FIELDS)[number];

export type FactSource = "manual" | "agent" | "igdb:multiplayer_modes" | "igdb:game_modes" | "igdb:time_to_beat" | "derived";

export type Fact<T> = { value: T; source: FactSource; sourceUrl?: string | null; note?: string | null } | { value: null; source: null };

export type PlayerProfile = {
  singlePlayer: Fact<boolean>;
  multiplayer: Fact<boolean>;
  coop: Fact<boolean>;
  localCoop: Fact<boolean>;
  onlineCoop: Fact<boolean>;
  splitscreen: Fact<boolean>;
  maxPlayers: Fact<number>;
  coopMaxPlayers: Fact<number>;
  simultaneousPlay: Fact<boolean>;
  playtimeMinutes: Fact<number>;
};

/** The catalog columns the resolver reads. */
export type CatalogPlayerData = {
  gameModes: number[];
  mpOfflineMax: number | null;
  mpOfflineCoopMax: number | null;
  mpOfflineCoop: boolean | null;
  mpSplitscreen: boolean | null;
  mpCampaignCoop: boolean | null;
  mpOnlineCoop: boolean | null;
  mpOnlineMax: number | null;
  ttbNormally: number | null;
};

/**
 * A `CatalogGame` row, as far as player data is concerned. The columns are
 * enumerated in one place on purpose: four callers used to spell this literal
 * out by hand, so adding a column meant remembering all four, and forgetting
 * one lost the data silently on that surface only.
 */
export type CatalogPlayerRow = {
  gameModes: string;
  mpOfflineMax: number | null;
  mpOfflineCoopMax: number | null;
  mpOfflineCoop: boolean | null;
  mpSplitscreen: boolean | null;
  mpCampaignCoop: boolean | null;
  mpOnlineCoop: boolean | null;
  mpOnlineMax: number | null;
  ttbNormally: number | null;
};

/** The Prisma `select` that fills a `CatalogPlayerRow`. */
export const CATALOG_PLAYER_COLUMNS = {
  gameModes: true,
  mpOfflineMax: true,
  mpOfflineCoopMax: true,
  mpOfflineCoop: true,
  mpSplitscreen: true,
  mpCampaignCoop: true,
  mpOnlineCoop: true,
  mpOnlineMax: true,
  ttbNormally: true,
} as const;

export function catalogPlayerData(c: CatalogPlayerRow | null | undefined): CatalogPlayerData | null {
  if (!c) return null;
  let gameModes: number[] = [];
  try {
    const v = JSON.parse(c.gameModes);
    if (Array.isArray(v)) gameModes = v as number[];
  } catch {
    // A malformed row means no modes, not a crashed page.
  }
  return {
    gameModes,
    mpOfflineMax: c.mpOfflineMax,
    mpOfflineCoopMax: c.mpOfflineCoopMax,
    mpOfflineCoop: c.mpOfflineCoop,
    mpSplitscreen: c.mpSplitscreen,
    mpCampaignCoop: c.mpCampaignCoop,
    mpOnlineCoop: c.mpOnlineCoop,
    mpOnlineMax: c.mpOnlineMax,
    ttbNormally: c.ttbNormally,
  };
}

export type Override = { field: string; value: string; source: string; sourceUrl?: string | null; note?: string | null };

export const GAME_MODE = { single: 1, multiplayer: 2, coop: 3, splitscreen: 4 } as const;

const UNKNOWN: Fact<never> = { value: null, source: null };

function fromCatalog(c: CatalogPlayerData | null): PlayerProfile {
  const p: PlayerProfile = {
    singlePlayer: UNKNOWN,
    multiplayer: UNKNOWN,
    coop: UNKNOWN,
    localCoop: UNKNOWN,
    onlineCoop: UNKNOWN,
    splitscreen: UNKNOWN,
    maxPlayers: UNKNOWN,
    coopMaxPlayers: UNKNOWN,
    simultaneousPlay: UNKNOWN,
    playtimeMinutes: UNKNOWN,
  };
  if (!c) return p;
  const modes = c.gameModes;
  if (modes.length) {
    p.singlePlayer = { value: modes.includes(GAME_MODE.single), source: "igdb:game_modes" };
    p.multiplayer = { value: modes.includes(GAME_MODE.multiplayer) || modes.includes(GAME_MODE.coop) || modes.includes(GAME_MODE.splitscreen), source: "igdb:game_modes" };
    p.coop = { value: modes.includes(GAME_MODE.coop), source: "igdb:game_modes" };
    p.splitscreen = { value: modes.includes(GAME_MODE.splitscreen), source: "igdb:game_modes" };
  }
  // multiplayer_modes is more specific, so it wins over game_modes where present.
  if (c.mpOfflineMax != null) p.maxPlayers = { value: c.mpOfflineMax, source: "igdb:multiplayer_modes" };
  // An online-only game has no offline max at all; its online max is still a
  // real ceiling on how many people can be in the session.
  else if (c.mpOnlineMax != null && c.mpOnlineMax > 1) p.maxPlayers = { value: c.mpOnlineMax, source: "igdb:multiplayer_modes" };
  if (c.mpOfflineCoopMax != null) p.coopMaxPlayers = { value: c.mpOfflineCoopMax, source: "igdb:multiplayer_modes" };
  if (c.mpSplitscreen != null) p.splitscreen = { value: c.mpSplitscreen || p.splitscreen.value === true, source: "igdb:multiplayer_modes" };

  // The two kinds, each from its own column. `offlinecoopmax > 1` is offline
  // co-op stated as a number, so it counts as the same evidence.
  if (c.mpOfflineCoop != null) p.localCoop = { value: c.mpOfflineCoop, source: "igdb:multiplayer_modes" };
  if (p.localCoop.value !== true && c.mpOfflineCoopMax != null && c.mpOfflineCoopMax > 1) p.localCoop = { value: true, source: "igdb:multiplayer_modes" };
  if (c.mpOnlineCoop != null) p.onlineCoop = { value: c.mpOnlineCoop, source: "igdb:multiplayer_modes" };

  // The umbrella. Either kind being true makes it co-op; a kind being false
  // never makes it *not* co-op, because IGDB's multiplayer_modes rows are
  // per-platform and routinely partial — game_modes saying "Co-Operative"
  // still stands, we just do not know which kind.
  if (p.localCoop.value === true || p.onlineCoop.value === true) p.coop = { value: true, source: "igdb:multiplayer_modes" };

  const maxKnown = c.mpOfflineMax ?? c.mpOnlineMax;
  if (maxKnown != null && maxKnown > 1 && p.multiplayer.value !== true) {
    p.multiplayer = { value: true, source: "igdb:multiplayer_modes" };
  }
  if (c.ttbNormally != null) p.playtimeMinutes = { value: c.ttbNormally, source: "igdb:time_to_beat" };
  return p;
}

function parseOverride(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function applyOverrides(p: PlayerProfile, overrides: Override[]): PlayerProfile {
  const out = { ...p };
  // manual beats agent: apply agent first, then manual.
  const ordered = [...overrides].sort((a, b) => (a.source === "manual" ? 1 : 0) - (b.source === "manual" ? 1 : 0));
  for (const o of ordered) {
    if (!(FACT_FIELDS as readonly string[]).includes(o.field)) continue;
    if (o.source !== "manual" && o.source !== "agent") continue;
    const field = o.field as FactField;
    const value = parseOverride(o.value);
    if (value == null) continue;
    const fact = { value, source: o.source, sourceUrl: o.sourceUrl ?? null, note: o.note ?? null };
    switch (field) {
      case "maxPlayers":
      case "coopMaxPlayers":
      case "playtimeMinutes":
        if (typeof value === "number") out[field] = fact as Fact<number>;
        break;
      default:
        if (typeof value === "boolean") out[field] = fact as Fact<boolean>;
    }
  }
  return out;
}

/**
 * simultaneousPlay is ours, not IGDB's. Derive it only where the evidence is
 * unambiguous; leave null otherwise for enrichment.
 */
function derive(p: PlayerProfile, c: CatalogPlayerData | null): PlayerProfile {
  const out = { ...p };
  if (out.simultaneousPlay.value == null) {
    if (c?.mpOfflineCoop === true || c?.mpSplitscreen === true || c?.mpCampaignCoop === true) {
      out.simultaneousPlay = { value: true, source: "derived", note: "IGDB marks offline co-op or split screen" };
    } else if (out.coop.value === true && out.coop.source !== "igdb:game_modes") {
      out.simultaneousPlay = { value: true, source: "derived", note: "co-op implies playing together" };
    } else if (out.multiplayer.value === false) {
      out.simultaneousPlay = { value: false, source: "derived", note: "single player only" };
    }
  }
  // Split screen is one screen in one room. On its own it could be versus, so
  // it only names a kind on a game we already know is cooperative.
  if (out.localCoop.value == null && out.coop.value === true && out.splitscreen.value === true) {
    out.localCoop = { value: true, source: "derived", note: "co-op on a split screen is a couch" };
  }
  if (out.maxPlayers.value == null && out.multiplayer.value === false && out.singlePlayer.value === true) {
    out.maxPlayers = { value: 1, source: "derived", note: "single player only" };
  }
  if (out.maxPlayers.value == null && out.coopMaxPlayers.value != null) {
    out.maxPlayers = { value: out.coopMaxPlayers.value, source: "derived", note: "at least the co-op count" };
  }
  return out;
}

export function resolvePlayerProfile(catalog: CatalogPlayerData | null, overrides: Override[] = []): PlayerProfile {
  return derive(applyOverrides(fromCatalog(catalog), overrides), catalog);
}
