/**
 * The one place player labelling is defined.
 *
 * "Multiplayer" used to be a smear of ad-hoc strings — "Co-op", "Multiplayer",
 * "1–2 players together", "Same screen", "Turns" — invented separately by the
 * card, the flip view and the game page. This module replaces all of them with
 * one vocabulary of **three independent axes**, so a game is described the same
 * way everywhere:
 *
 *   COUNT          a range: "1", "1–2", "2–4" (en dash, never a hyphen)
 *   CO-OP          "Local co-op" (couch / same console / split screen),
 *                  "Online co-op" (remote), or "Local + online co-op".
 *                  Never a bare "Co-op": if we know it at all, we know which.
 *   TOGETHERNESS   "Together" (simultaneous) vs "Taking turns" (alternating).
 *                  Super Mario Kart is 1–2 together; Donkey Kong Country is
 *                  1–2 taking turns. Only meaningful above one player.
 *
 * Multiplayer we know is *not* co-op is "Versus".
 *
 * Each axis carries its own confidence tier — `exact` (a hand-set fact, an
 * enrichment run, or IGDB's `multiplayer_modes`), `mode` (IGDB's `game_modes`,
 * or something we inferred), `unknown` (no data) — and whether a person or an
 * agent verified it. Unknown is never rendered as "no": a missing count shows
 * as "? players", not "1 player".
 *
 * Every stored IGDB column we have (`gameModes`, `mpOfflineMax`,
 * `mpOfflineCoopMax`, `mpOfflineCoop`, `mpSplitscreen`, `mpCampaignCoop`)
 * describes **local** play, so IGDB can only ever tell us about local co-op.
 * Online co-op is the `onlineCoop` fact: unknown everywhere until an owner or
 * a research agent fills it in.
 *
 * Pure — no Prisma, no React. Everything that renders player info calls
 * `describePlayers` rather than assembling a string of its own.
 */

import type { Fact, FactSource, PlayerProfile } from "@/lib/facts";

/** How much we know about one axis. */
export type PlayerTier = "exact" | "mode" | "unknown";

export type CoopKind = "local" | "online" | "both";
export type Togetherness = "simultaneous" | "alternating";

/** The whole display vocabulary, in one object so nothing re-spells it. */
export const PLAYER_LABELS = {
  local: "Local co-op",
  online: "Online co-op",
  both: "Local + online co-op",
  versus: "Versus",
  /** Known to be more than one player, but not whether co-op or versus. */
  multiplayer: "Multiplayer",
  simultaneous: "Together",
  alternating: "Taking turns",
  onePlayer: "1 player",
  unknown: "? players",
} as const;

export type Axis<T> = {
  value: T | null;
  /** The word we show, or null when the axis says nothing. */
  label: string | null;
  tier: PlayerTier;
  /** Set by hand or by an enrichment run, rather than taken from IGDB. */
  verified: boolean;
  /** The value shown was inferred from other facts, not stated by anyone. */
  inferred: boolean;
};

export type CountAxis = Axis<string> & { min: number | null; max: number | null };

export type CoopAxis = Axis<CoopKind> & {
  /**
   * Local co-op explicitly ruled out. Not the same as "no co-op at all" —
   * `onlineCoop` may still be unknown — which is why `versus` also requires a
   * confirmed multiplayer count before it will call a game versus.
   */
  none: boolean;
};

export type PlayerDescription = {
  count: CountAxis;
  coop: CoopAxis;
  together: Axis<Togetherness>;
  /** Multiplayer that we know is not co-op. */
  versus: boolean;
  /** The words that follow the range, most important first. */
  qualifiers: string[];
  /** The compact line: `1–2 · Local co-op · Together`. */
  short: string;
  tier: PlayerTier;
  verified: boolean;
  /** Any of the words shown was inferred rather than stated. */
  inferred: boolean;
};

const TIER_BY_SOURCE: Record<FactSource, PlayerTier> = {
  manual: "exact",
  agent: "exact",
  "igdb:multiplayer_modes": "exact",
  "igdb:game_modes": "mode",
  "igdb:time_to_beat": "mode",
  // Inferred from other facts — real, but not measured.
  derived: "mode",
};

type AnyFact = Fact<boolean> | Fact<number>;

/** The strongest evidence among the facts that actually carry a value. */
function tierOf(...facts: AnyFact[]): PlayerTier {
  let tier: PlayerTier = "unknown";
  for (const f of facts) {
    if (f.value == null || !f.source) continue;
    const t = TIER_BY_SOURCE[f.source];
    if (t === "exact") return "exact";
    tier = "mode";
  }
  return tier;
}

function verifiedBy(...facts: AnyFact[]): boolean {
  return facts.some((f) => f.value != null && (f.source === "manual" || f.source === "agent"));
}

function inferredFrom(...facts: AnyFact[]): boolean {
  return facts.some((f) => f.value != null && f.source === "derived");
}

/**
 * The count axis. Min is 1 unless single-player is explicitly ruled out, in
 * which case the smallest party the game supports is 2 — we have no "minimum
 * players" fact finer than that, and inventing one would be a guess.
 */
function countAxis(p: PlayerProfile): CountAxis {
  const max = p.maxPlayers.value;
  const facts: AnyFact[] = [p.maxPlayers, p.singlePlayer];
  if (max == null) return { value: null, label: null, min: null, max: null, tier: "unknown", verified: verifiedBy(p.maxPlayers), inferred: false };
  const min = p.singlePlayer.value === false && max > 1 ? 2 : 1;
  const label = max <= 1 ? "1" : min >= max ? String(max) : `${min}–${max}`;
  return { value: label, label, min, max, tier: tierOf(p.maxPlayers), verified: verifiedBy(...facts), inferred: inferredFrom(p.maxPlayers) };
}

function coopAxis(p: PlayerProfile): CoopAxis {
  // Every IGDB signal we store is about the same couch, so split screen and
  // offline co-op both land on "local". Online only ever comes from the
  // `onlineCoop` fact.
  const local = p.coop.value === true || p.splitscreen.value === true;
  const online = p.onlineCoop.value === true;
  const value: CoopKind | null = local && online ? "both" : local ? "local" : online ? "online" : null;
  const facts: AnyFact[] = [p.coop, p.splitscreen, p.onlineCoop];
  return {
    value,
    label: value ? PLAYER_LABELS[value] : null,
    none: value === null && p.coop.value === false,
    tier: tierOf(...facts),
    verified: verifiedBy(...facts),
    inferred: inferredFrom(...facts),
  };
}

export function describePlayers(p: PlayerProfile): PlayerDescription {
  const count = countAxis(p);
  const coop = coopAxis(p);

  // More than one player, confirmed: an exact count above 1, or IGDB saying so
  // when we have no count at all. Everything below is suppressed without it —
  // "Taking turns" on a one-player game is noise, not information.
  const multiplayer = count.max != null ? count.max > 1 : p.multiplayer.value === true;

  const sim = p.simultaneousPlay;
  const togetherValue: Togetherness | null = !multiplayer || sim.value == null ? null : sim.value ? "simultaneous" : "alternating";
  const together: Axis<Togetherness> = {
    value: togetherValue,
    label: togetherValue ? PLAYER_LABELS[togetherValue] : null,
    tier: togetherValue ? tierOf(sim) : "unknown",
    verified: togetherValue ? verifiedBy(sim) : false,
    inferred: togetherValue ? inferredFrom(sim) : false,
  };

  const versus = multiplayer && coop.none;

  const qualifiers: string[] = [];
  if (coop.label) qualifiers.push(coop.label);
  else if (versus) qualifiers.push(PLAYER_LABELS.versus);
  else if (multiplayer && count.label == null) qualifiers.push(PLAYER_LABELS.multiplayer);
  if (together.label) qualifiers.push(together.label);

  // The line's tier is the count's, because the count is what leads it. Only
  // when there is no count at all does a qualifier get to speak for the line.
  const tier = count.tier !== "unknown" ? count.tier : coop.tier !== "unknown" ? coop.tier : together.tier !== "unknown" ? together.tier : tierOf(p.multiplayer, p.singlePlayer);
  const description: PlayerDescription = {
    count,
    coop,
    together,
    versus,
    qualifiers,
    short: "",
    tier,
    verified: count.verified || coop.verified || together.verified,
    inferred: count.inferred || coop.inferred || together.inferred,
  };
  description.short = playersShort(description);
  return description;
}

/**
 * The compact line: the range, then at most `maxQualifiers` words after it.
 * The range stands alone as a sentence ("1 player", "1–4 players") but shrinks
 * to bare digits once a qualifier follows it, because "1–2 players · Local
 * co-op · Together" does not fit a phone card and "1–2 · Local co-op ·
 * Together" does. Qualifiers are already in priority order, so trimming drops
 * the least important one — togetherness before co-op.
 */
export function playersShort(d: PlayerDescription, maxQualifiers = 2): string {
  const quals = d.qualifiers.slice(0, Math.max(0, maxQualifiers));
  const segments: string[] = [];
  const range = d.count.label;
  if (range) segments.push(quals.length ? range : range === "1" ? PLAYER_LABELS.onePlayer : `${range} players`);
  segments.push(...quals);
  return segments.length ? segments.join(" · ") : PLAYER_LABELS.unknown;
}

/** What the tier means, for a tooltip. */
export function tierHint(tier: PlayerTier): string {
  return tier === "unknown" ? "No player data yet" : tier === "mode" ? "From IGDB game modes, or inferred" : "Exact count";
}
