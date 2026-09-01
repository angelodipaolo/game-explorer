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
 *   CO-OP          "Co-op" when we know it is cooperative but not which kind,
 *                  then "Local co-op" (couch / same console / split screen),
 *                  "Online co-op" (remote), or "Local + online co-op" once the
 *                  evidence is kind-specific. A kind is NEVER inferred from the
 *                  bare co-op signal: IGDB's `game_modes` id 3 is
 *                  "Co-Operative", which Bloodborne, Destiny and DOOM all
 *                  carry, and none of them is a couch game. A co-op fact the
 *                  owner set by hand means the same umbrella thing, so it
 *                  renders as plain "Co-op" too.
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
 * IGDB answers both kinds and we store both: `mpOfflineCoop` /
 * `mpOfflineCoopMax` / `mpSplitscreen` are the couch, `mpOnlineCoop` /
 * `mpOnlineMax` are the network. `src/lib/facts.ts` maps them onto `localCoop`
 * and `onlineCoop`; a hand-set or researched fact still beats either.
 *
 * Pure — no Prisma, no React. Everything that renders player info calls
 * `describePlayers` rather than assembling a string of its own.
 */

import type { Fact, FactSource, PlayerProfile } from "@/lib/facts";

/** How much we know about one axis. */
export type PlayerTier = "exact" | "mode" | "unknown";

export type CoopKind = "coop" | "local" | "online" | "both";
export type Togetherness = "simultaneous" | "alternating";

/** The whole display vocabulary, in one object so nothing re-spells it. */
export const PLAYER_LABELS = {
  /** Cooperative, kind not known. */
  coop: "Co-op",
  local: "Local co-op",
  online: "Online co-op",
  both: "Local + online co-op",
  /** "Local + online co-op" does not fit a phone card; this does. */
  bothBrief: "Local + online",
  versus: "Versus",
  /** Known to be more than one player, but not whether co-op or versus. */
  multiplayer: "Multiplayer",
  simultaneous: "Together",
  alternating: "Taking turns",
  one: "1",
  onePlayer: "1 player",
  unknown: "? players",
} as const;

/**
 * The three `mode=` filter values, in this module's words. The VALUES are the
 * URL and must never change — every saved link and preset carries them — but
 * the words a person reads come from here, so the filter sheet, the home rows
 * and Flip's "what you asked for" line cannot drift apart.
 */
export type PlayMode = "coop" | "versus" | "together";

export const MODE_LABELS: Record<PlayMode, string> = {
  coop: PLAYER_LABELS.coop,
  versus: PLAYER_LABELS.versus,
  together: PLAYER_LABELS.simultaneous,
};

export function modeLabel(mode: PlayMode | string | null): string | null {
  return mode && mode in MODE_LABELS ? MODE_LABELS[mode as PlayMode] : null;
}

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
   * Co-op ruled out: either the umbrella fact says no, or both kinds do. A
   * single kind being false proves nothing on its own — an online-co-op game
   * has `localCoop: false` — which is why this is not simply `!value`.
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
  /** The same words, in the shortest spelling a phone card can hold. */
  qualifiersBrief: string[];
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
 * The count axis. The floor is 1 when single player is confirmed and 2 when it
 * is ruled out — and **unknown when nobody has said**, which renders as "Up to
 * 4" rather than "1–4". A count with no floor under it is exactly the kind of
 * unknown this project refuses to render as a yes: "1–4" claims you can play
 * it alone, and an offline max of 4 does not say that.
 */
function countAxis(p: PlayerProfile): CountAxis {
  const max = p.maxPlayers.value;
  // `multiplayer` belongs here: it is a player-count fact, and a game whose
  // only hand-set fact is "yes, multiplayer" has still been verified by hand.
  const facts: AnyFact[] = [p.maxPlayers, p.singlePlayer, p.multiplayer];
  if (max == null) return { value: null, label: null, min: null, max: null, tier: tierOf(p.multiplayer), verified: verifiedBy(...facts), inferred: false };
  const min = max <= 1 ? 1 : p.singlePlayer.value === true ? 1 : p.singlePlayer.value === false ? 2 : null;
  const label = max <= 1 ? "1" : min == null ? `Up to ${max}` : min >= max ? String(max) : `${min}–${max}`;
  // A single-player-only game's "1" is a restatement of a stated fact, not an
  // inference across facts, so it keeps the crisp tier. A count derived from
  // `coopMaxPlayers` is only a floor on the real maximum, so it does not.
  const restated = p.maxPlayers.source === "derived" && max === 1 && p.multiplayer.value === false;
  return { value: label, label, min, max, tier: restated ? "exact" : tierOf(p.maxPlayers), verified: verifiedBy(...facts), inferred: !restated && inferredFrom(p.maxPlayers) };
}

/**
 * The co-op axis, and the one rule that matters: a KIND is only claimed from
 * kind-specific evidence. The umbrella `coop` fact — IGDB's "Co-Operative"
 * tag, or a co-op fact the owner set by hand — says a game is cooperative and
 * nothing more, so it renders as a bare "Co-op" until `localCoop` or
 * `onlineCoop` says which.
 */
function coopAxis(p: PlayerProfile): CoopAxis {
  const local = p.localCoop.value === true;
  const online = p.onlineCoop.value === true;
  const anyCoop = local || online || p.coop.value === true;
  const value: CoopKind | null = local && online ? "both" : local ? "local" : online ? "online" : anyCoop ? "coop" : null;
  // Only the facts that produced the label speak for its confidence: an
  // exact-tier `localCoop: false` must not make a game_modes-tier "Co-op" read
  // as though someone had counted it.
  const facts: AnyFact[] = value === "coop" ? [p.coop] : value === "local" ? [p.localCoop] : value === "online" ? [p.onlineCoop] : value === "both" ? [p.localCoop, p.onlineCoop] : [p.coop, p.localCoop, p.onlineCoop];
  return {
    value,
    label: value ? PLAYER_LABELS[value] : null,
    none: !anyCoop && (p.coop.value === false || (p.localCoop.value === false && p.onlineCoop.value === false)),
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
  // Provenance is about the fact, not about whether there is room to show it:
  // suppress the *label* on a one-player game, never the ✓ that says a person
  // set this by hand.
  const together: Axis<Togetherness> = {
    value: togetherValue,
    label: togetherValue ? PLAYER_LABELS[togetherValue] : null,
    tier: tierOf(sim),
    verified: verifiedBy(sim),
    inferred: togetherValue ? inferredFrom(sim) : false,
  };

  const versus = multiplayer && coop.none;

  const qualifiers: string[] = [];
  const qualifiersBrief: string[] = [];
  if (coop.label) {
    qualifiers.push(coop.label);
    qualifiersBrief.push(coop.value === "both" ? PLAYER_LABELS.bothBrief : coop.label);
  } else if (versus) {
    qualifiers.push(PLAYER_LABELS.versus);
    qualifiersBrief.push(PLAYER_LABELS.versus);
  } else if (multiplayer && count.label == null) {
    qualifiers.push(PLAYER_LABELS.multiplayer);
    qualifiersBrief.push(PLAYER_LABELS.multiplayer);
  }
  if (together.label) {
    qualifiers.push(together.label);
    qualifiersBrief.push(together.label);
  }

  // The line's tier is the count's, because the count is what leads it. Only
  // when there is no count at all does a qualifier get to speak for the line.
  const tier = count.tier !== "unknown" ? count.tier : coop.tier !== "unknown" ? coop.tier : together.label ? together.tier : tierOf(p.singlePlayer);
  const description: PlayerDescription = {
    count,
    coop,
    together,
    versus,
    qualifiers,
    qualifiersBrief,
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
export function playersShort(d: PlayerDescription, maxQualifiers = 2, brief = false): string {
  const quals = (brief ? d.qualifiersBrief : d.qualifiers).slice(0, Math.max(0, maxQualifiers));
  const segments: string[] = [];
  const range = d.count.label;
  if (range) segments.push(quals.length ? range : range === PLAYER_LABELS.one ? PLAYER_LABELS.onePlayer : `${range} players`);
  segments.push(...quals);
  return segments.length ? segments.join(" · ") : PLAYER_LABELS.unknown;
}

/**
 * Which of the two precomputed lines a card shows, and the fallback when a
 * caller hands over an empty one (a view model built before the label was, or
 * a fixture). "? players" is the honest floor: never an empty span.
 */
export function playersLineLabel(players: { label: string; brief: string }, brief = false): string {
  return (brief ? players.brief || players.label : players.label) || PLAYER_LABELS.unknown;
}

/** What the tier means, for a tooltip. */
export function tierHint(tier: PlayerTier): string {
  return tier === "unknown" ? "No player data yet" : tier === "mode" ? "From IGDB game modes, or inferred" : "Exact count";
}
