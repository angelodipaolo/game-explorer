import type { IgdbSearchHit } from "@/lib/igdb";
import { compactKey, contentTokens, normalizeTitle, stripBrackets, titleVariants } from "./normalize";

/**
 * Title matching: search IGDB with a few spellings of the title, merge the
 * hits, and score each against the query. The score is a confidence in
 * [0, 1] that this hit IS the cartridge, not merely a related game.
 */

export type MatchCandidate = {
  igdbId: number;
  name: string;
  slug: string | null;
  confidence: number;
  gameType: number | null;
  /** IGDB parent (a port's original, a bundle's base). Used to spot "same game twice". */
  parentId: number | null;
  /** False when the hit came from the no-platform fallback pass. */
  onPlatform: boolean;
  /** Which spelling of the title produced the best score. */
  via: string;
  coverImageId: string | null;
  firstReleaseYear: number | null;
  platformNames: string[];
  /** Why the score is what it is — surfaced in review. */
  reason: string;
};

export type SearchFn = (term: string, platformIds?: number[]) => Promise<IgdbSearchHit[]>;

const SEQUEL_TOKEN = /^(\d+|i{1,3}|iv|v|vi{0,3}|ix|x|part\s*\d+|[2-9]\d*)$/;

/** `Zoda's Revenge: StarTropics II` and `Star Tropics II: Zoda's Revenge` share a parts key. */
function partsKey(title: string): string {
  return title
    .split(/[:\u2013\u2014]| - /)
    .map((p) => normalizeTitle(p).replace(/\s/g, ""))
    .filter(Boolean)
    .sort()
    .join("|");
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}

/** Confidence assigned to each relationship between shelf title and IGDB name. */
export const SCORE = {
  exact: 1,
  sameWords: 0.95,
  reordered: 0.95,
  brandPrefix: 0.9,
  /** Candidate = title + ": subtitle" — very likely the same cartridge, but a person confirms. */
  subtitleExtends: 0.88,
  otherPrefix: 0.7,
  extends: 0.7,
  sequel: 0.45,
  contains: 0.6,
  truncated: 0.55,
  querySequel: 0.4,
} as const;

/** Score how well a candidate name matches the query title. */
export function scoreName(query: string, candidate: string): { score: number; reason: string } {
  const q = normalizeTitle(query);
  const c = normalizeTitle(candidate);
  const qk = q.replace(/\s/g, "");
  const ck = c.replace(/\s/g, "");
  if (!qk || !ck) return { score: 0, reason: "empty" };
  if (qk === ck) return { score: SCORE.exact, reason: "exact" };
  if (partsKey(query) === partsKey(candidate)) return { score: SCORE.reordered, reason: "same title, subtitle reordered" };
  if (contentTokens(query).join(" ") === contentTokens(candidate).join(" ")) return { score: SCORE.sameWords, reason: "same words" };

  const qTokens = q.split(" ");
  const cTokens = c.split(" ");
  void qTokens;

  if (ck.startsWith(qk)) {
    const restTokens = cTokens.slice(qTokens.length).join(" ").trim();
    const tail = ck.slice(qk.length);
    // Candidate = query + trailing sequel marker (Gauntlet → Gauntlet II): a different game.
    if (SEQUEL_TOKEN.test(tail)) return { score: SCORE.sequel, reason: `sequel marker "${restTokens || tail}"` };
    // Candidate = query + ": subtitle" (Skate or Die 2 → Skate or Die 2: The Search for Double Trouble).
    const prefixLen = candidate.replace(/[^A-Za-z0-9]/g, "").length - ck.length + qk.length;
    const rawTail = subtitleAfter(candidate, prefixLen);
    if (rawTail !== null && !SEQUEL_TOKEN.test(normalizeTitle(rawTail))) {
      return { score: SCORE.subtitleExtends, reason: `candidate adds subtitle "${rawTail}"` };
    }
    // Query is a prefix of a longer title (Contra → Contra Force)
    return { score: SCORE.extends, reason: `candidate extends title with "${restTokens || tail}"` };
  }

  if (ck.endsWith(qk)) {
    const head = ck.slice(0, ck.length - qk.length);
    const rawHead = candidate.slice(0, Math.max(0, candidate.length - query.length)).trim() || head;
    // Possessive brand prefix (Duck Tales → Disney's DuckTales) is the same game; anything else ("Super", "Target:") is not.
    if (/s$/.test(head) && head.length <= 12) {
      return { score: SCORE.brandPrefix, reason: `brand prefix "${rawHead}"` };
    }
    return { score: SCORE.otherPrefix, reason: `candidate prefixes title with "${rawHead}"` };
  }

  if (ck.includes(qk)) return { score: SCORE.contains, reason: "title contained in candidate" };

  if (qk.startsWith(ck)) {
    const tail = qTokens.slice(cTokens.length).join(" ");
    if (SEQUEL_TOKEN.test(tail)) return { score: SCORE.querySequel, reason: `query has sequel marker "${tail}" candidate lacks` };
    return { score: SCORE.truncated, reason: `candidate is a prefix of the title` };
  }

  const dist = levenshtein(qk, ck);
  const ratio = 1 - dist / Math.max(qk.length, ck.length);
  return { score: Math.max(0, Math.min(0.7, ratio * 0.8)), reason: `edit distance ${dist}` };
}

/**
 * If `candidate` has a ":" (or " - ") right after its first `alnumCount`
 * alphanumerics, return what follows; otherwise null.
 */
function subtitleAfter(candidate: string, alnumCount: number): string | null {
  let seen = 0;
  for (let i = 0; i < candidate.length; i++) {
    if (/[A-Za-z0-9]/.test(candidate[i])) {
      seen++;
      if (seen === alnumCount) {
        const rest = candidate.slice(i + 1);
        const m = rest.match(/^\s*[.!]?\s*(?::|-|\u2013|\u2014)\s+(.+)$/);
        return m ? m[1] : null;
      }
    }
  }
  return null;
}

/** Alternative names are less trustworthy than the primary name: an exact alt match can auto-accept, but a primary exact beats it. */
export const ALT_NAME_CAP = 0.92;

/** Score a hit using its name and alternative names; keeps the best. */
export function scoreHit(query: string, hit: IgdbSearchHit): { score: number; reason: string } {
  const q = stripBrackets(query);
  let best = scoreName(q, hit.name);
  for (const alt of hit.alternative_names ?? []) {
    const s = scoreName(q, alt.name);
    const adj = { score: Math.min(s.score, ALT_NAME_CAP), reason: `alt name "${alt.name}": ${s.reason}` };
    if (adj.score > best.score) best = adj;
  }
  return best;
}

export function toCandidate(hit: IgdbSearchHit, confidence: number, via: string, reason: string, onPlatform = true): MatchCandidate {
  return {
    igdbId: hit.id,
    name: hit.name,
    slug: hit.slug ?? null,
    confidence: Math.round(confidence * 1000) / 1000,
    gameType: hit.game_type ?? null,
    parentId: hit.parent_game ?? hit.version_parent ?? null,
    onPlatform,
    via,
    coverImageId: hit.cover?.image_id ?? null,
    firstReleaseYear: hit.first_release_date ? new Date(hit.first_release_date * 1000).getUTCFullYear() : null,
    platformNames: (hit.platforms ?? []).map((p) => p.name),
    reason,
  };
}

/**
 * Search every variant of the title, merge, rank. Stops early when a variant
 * yields an exact match — the remaining variants can only add noise.
 *
 * If nothing convincing turns up on the requested platform, one more pass
 * runs without the platform filter: IGDB sometimes lacks the platform tag on
 * a real release (RollerGames). Those hits are capped below auto-accept so a
 * person confirms them.
 */
export async function findCandidates(title: string, platformIds: number[] | undefined, search: SearchFn, limit = 8): Promise<MatchCandidate[]> {
  const byId = new Map<number, MatchCandidate>();
  const consider = (hits: IgdbSearchHit[], term: string, onPlatform: boolean) => {
    for (const hit of hits) {
      let { score, reason } = scoreHit(title, hit);
      if (!onPlatform) {
        score = Math.min(score, OFF_PLATFORM_CAP);
        reason = `${reason}; IGDB lists no release on this platform`;
      }
      const existing = byId.get(hit.id);
      if (!existing || existing.confidence < score) byId.set(hit.id, toCandidate(hit, score, term, reason, onPlatform));
    }
  };
  const convincing = () => [...byId.values()].some((c) => c.confidence >= 0.99);

  const variants = titleVariants(title);
  for (const term of variants) {
    consider(await search(term, platformIds), term, true);
    if (convincing()) break;
  }
  if (platformIds?.length && ![...byId.values()].some((c) => c.confidence >= AUTO_ACCEPT_MIN)) {
    for (const term of variants) {
      consider(await search(term, undefined), term, false);
      if ([...byId.values()].some((c) => !c.onPlatform && c.confidence >= OFF_PLATFORM_CAP)) break;
    }
  }
  return rank([...byId.values()]).slice(0, limit);
}

/** Higher confidence first; on a tie prefer the platform-specific entry (fewer platforms), then main games. */
export function rank(candidates: MatchCandidate[]): MatchCandidate[] {
  return [...candidates].sort(
    (a, b) =>
      b.confidence - a.confidence ||
      a.platformNames.length - b.platformNames.length ||
      (a.gameType ?? 99) - (b.gameType ?? 99) ||
      a.name.localeCompare(b.name),
  );
}

/** A hit reached only through the no-platform fallback never auto-accepts. */
export const OFF_PLATFORM_CAP = 0.8;

/** Thresholds for automatic acceptance. */
export const AUTO_ACCEPT_MIN = 0.9;
export const AUTO_ACCEPT_MARGIN = 0.08;

export type MatchVerdict =
  | { kind: "auto"; candidate: MatchCandidate }
  | { kind: "ambiguous"; candidates: MatchCandidate[] }
  | { kind: "low-confidence"; candidates: MatchCandidate[] }
  | { kind: "no-match" };

export function decide(candidates: MatchCandidate[]): MatchVerdict {
  if (!candidates.length) return { kind: "no-match" };
  const [top] = candidates;
  if (top.confidence < AUTO_ACCEPT_MIN) return { kind: "low-confidence", candidates };
  // A port and its original (or a bundle and its base) are the same game for
  // our purposes; they do not make the match ambiguous.
  const rival = candidates.slice(1).find((c) => !sameGame(top, c));
  if (rival && top.confidence - rival.confidence < AUTO_ACCEPT_MARGIN) return { kind: "ambiguous", candidates };
  return { kind: "auto", candidate: top };
}

export function sameGame(a: MatchCandidate, b: MatchCandidate): boolean {
  return a.parentId === b.igdbId || b.parentId === a.igdbId || (a.parentId != null && a.parentId === b.parentId);
}

export { compactKey };
