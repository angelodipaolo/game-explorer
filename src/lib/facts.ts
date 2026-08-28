/**
 * Player facts, resolved from three sources with fixed precedence:
 *   manual  — Angelo set it by hand; never overwritten
 *   agent   — an enrichment run found it, with a cited source
 *   catalog — IGDB, in two tiers: game_modes (co-op yes/no) and
 *             multiplayer_modes (exact counts)
 *   derived — computed from other facts (simultaneousPlay from offlinecoop)
 *
 * Every resolved value carries where it came from so the UI can show
 * "verified" vs "from IGDB" vs "unknown".
 */

export const FACT_FIELDS = [
  "singlePlayer",
  "multiplayer",
  "coop",
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
  ttbNormally: number | null;
};

export type Override = { field: string; value: string; source: string; sourceUrl?: string | null; note?: string | null };

export const GAME_MODE = { single: 1, multiplayer: 2, coop: 3, splitscreen: 4 } as const;

const UNKNOWN: Fact<never> = { value: null, source: null };

function fromCatalog(c: CatalogPlayerData | null): PlayerProfile {
  const p: PlayerProfile = {
    singlePlayer: UNKNOWN,
    multiplayer: UNKNOWN,
    coop: UNKNOWN,
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
  if (c.mpOfflineCoopMax != null) p.coopMaxPlayers = { value: c.mpOfflineCoopMax, source: "igdb:multiplayer_modes" };
  if (c.mpOfflineCoop != null) p.coop = { value: c.mpOfflineCoop || p.coop.value === true, source: "igdb:multiplayer_modes" };
  if (c.mpSplitscreen != null) p.splitscreen = { value: c.mpSplitscreen || p.splitscreen.value === true, source: "igdb:multiplayer_modes" };
  if (c.mpOfflineMax != null && c.mpOfflineMax > 1 && p.multiplayer.value !== true) {
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

/** How much do we know? Used by the UI to phrase the players line honestly. */
export function playerSummary(p: PlayerProfile): { label: string; tier: "exact" | "mode" | "unknown" } {
  if (p.maxPlayers.value != null) {
    const n = p.maxPlayers.value;
    if (n <= 1) return { label: "1 player", tier: "exact" };
    const together = p.simultaneousPlay.value === true ? " together" : p.simultaneousPlay.value === false ? ", taking turns" : "";
    return { label: `1–${n} players${together}`, tier: "exact" };
  }
  if (p.coop.value === true) return { label: "Co-op", tier: "mode" };
  if (p.multiplayer.value === true) return { label: "Multiplayer", tier: "mode" };
  if (p.singlePlayer.value === true && p.multiplayer.value === false) return { label: "1 player", tier: "mode" };
  return { label: "Players unknown", tier: "unknown" };
}
