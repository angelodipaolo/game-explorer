import type { ShelfGame } from "./collection";
import { DEFAULT_FILTERS, applyFilters, daySeed, seededShuffle, serializeFilters, type Filters } from "./filters";
import { platformBySlug } from "./platforms";
import { MODE_LABELS } from "./players";
import { tagKey } from "./tags";

/**
 * The front door's rows, derived in memory from the shelf that is already
 * loaded. No query per row, no scoring model, no LLM — a row is a *filter*,
 * and the pool of candidate filters is drawn from what the collection happens
 * to contain (its platforms, its tags, its eras, its series).
 *
 * Three rules shape everything here.
 *
 * **Deterministic per day.** Every choice — which candidates are considered,
 * in what order, and which games each row shows — comes from `daySeed(date)`
 * and `seededShuffle`, exactly as `tonightsPicks` does. Rows are therefore
 * identical across a reload and a back-navigation, and different tomorrow.
 * Nothing in this module may call `Math.random`, `Date.now`, or read the clock
 * except through the `date` argument.
 *
 * **A row's header link must return the row's games.** Each filter-backed row
 * carries the `Filters` it was built from, and its href is
 * `/shelf${serializeFilters(f)}` — the row is the seeded pick of what that URL
 * shows, never a set assembled some other way. `strict` is set on rows whose
 * filters are three-valued (players, mode, era) so the shelf shows exactly the
 * confirmed games the row drew from rather than the "could work" pile too.
 *
 * **Quality gates, not merely random.** A naive tag x platform cross product
 * offers "Puzzle games on Sega CD (2)". Candidates are rejected when they are
 * thin (`minRow`), when they are nearly the whole shelf (`MAX_ROW_SHARE`), when
 * they resolve to nearly the same set as a row already chosen (Jaccard over
 * `maxOverlap`, or containment over `MAX_CONTAINMENT` — a strict subset says
 * nothing new), or when they would show a game that has already appeared in
 * `maxPerGame` rows. When the gates cannot fill the page —
 * a small or narrow collection — deterministic broad fallback rows (platform,
 * then era) fill it with the gates progressively relaxed, so the page is never
 * half empty.
 */

/** A fixed count of rows, drawn from a much larger pool by the day's seed. */
export const HOME_ROWS = 8;
/** A row shorter than this is not a row; the combo that produced it is rejected. */
export const MIN_ROW = 8;
/** How many covers one carousel holds. The header link has the rest. */
export const ROW_SIZE = 24;
/** A game may be shown in at most this many rows, so the page is not one shelf repeated. */
export const MAX_ROWS_PER_GAME = 2;
/** Two rows whose sets are more alike than this are the same row twice. */
export const MAX_OVERLAP = 0.6;
/**
 * Jaccard alone lets a small row hide inside a big one: "Arcade games on the
 * NES" (30) against "Everything on the NES" (100) scores 0.3 and passes, yet
 * the smaller row shows nothing the bigger one does not. Containment —
 * shared / the smaller set — catches exactly that.
 */
export const MAX_CONTAINMENT = 0.8;
/**
 * A row that is essentially the whole shelf is not a row. It is what an
 * always-true filter looks like: with an empty play log, `play=never` matches
 * every game, and "You have never played these" renders as the collection.
 */
export const MAX_ROW_SHARE = 0.9;

export type HomeRowKind = "tag-platform" | "tag" | "players" | "era" | "platform" | "never-played" | "series";

export type HomeRow = {
  /** Stable identity for the row across a day — used as the React key and in tests. */
  key: string;
  kind: HomeRowKind;
  /** Reads as a sentence: "Puzzle games on the NES". */
  title: string;
  /** `/shelf?...` for a filter row, `/series/<slug>` for a series row. */
  href: string;
  /** What the carousel shows: at most ROW_SIZE of `total`. */
  games: ShelfGame[];
  /** How many games the header link resolves to. */
  total: number;
};

/** A series, reduced to what home needs: its owned copies, in series order. */
export type HomeSeries = { name: string; slug: string; ownedIds: string[] };

export type HomeOptions = {
  date?: Date;
  series?: HomeSeries[];
  rows?: number;
  minRow?: number;
  rowSize?: number;
  maxPerGame?: number;
  maxOverlap?: number;
};

/* ------------------------------------------------------------------ phrasing */

/**
 * IGDB's genre spellings are database labels, not English. A row title is a
 * sentence, so a handful of them are re-spelled for display only — the filter
 * value in the URL stays the tag the collection actually carries, which is
 * what keeps the header link honest.
 */
const TAG_PHRASE: Record<string, string> = {
  "role playing rpg": "RPG",
  "hack and slash beat em up": "beat 'em up",
  "card board game": "board game",
  "quiz trivia": "trivia",
  "turn based strategy tbs": "turn-based strategy",
  "real time strategy rts": "real-time strategy",
  "point and click": "point-and-click",
};

/** A tag whose spelling cannot be made into a sentence is not offered as a row. */
function tagPhrase(tag: string): string | null {
  const mapped = TAG_PHRASE[tagKey(tag)];
  if (mapped) return mapped;
  return /[/()]/.test(tag) ? null : tag;
}

/**
 * "the NES", "Super Nintendo". An acronym takes the article and a name does
 * not, which is the difference between "Everything on the SNES" and
 * "Everything on Switch".
 */
export function platformPhrase(slug: string): string {
  const p = platformBySlug(slug);
  const short = p?.short ?? slug.toUpperCase();
  return /[a-z]/.test(short) ? short : `the ${short}`;
}

const ERA_LABEL: Record<NonNullable<Filters["era"]>, string> = { "80s": "80s", "90s": "90s", "00s": "00s", "10s": "10s" };

/* ----------------------------------------------------------------- candidates */

type Candidate = {
  key: string;
  kind: HomeRowKind;
  title: string;
  /** Filter-backed rows: the URL and the set both come from this. */
  filters?: Filters;
  /** Series rows: the games are given, in series order, and the link is the series page. */
  href?: string;
  games?: ShelfGame[];
  /**
   * What the row is "about", for the variety caps — at most two rows may lean
   * on the same platform or the same tag.
   */
  facets: string[];
  /**
   * Offered only when the page cannot be filled the interesting way: a
   * platform too small to carry a row of its own is a fallback, not a
   * candidate competing with "Puzzle games on the NES".
   */
  fallback?: boolean;
};

function withFilters(patch: Partial<Filters>): Filters {
  const f = { ...DEFAULT_FILTERS, ...patch };
  // Players, mode and era are three-valued against sparse IGDB data: without
  // `strict` the shelf would also list the "could work" pile, and the row would
  // no longer be what its own link returns.
  return { ...f, strict: f.players != null || f.mode != null || f.era != null || f.length != null };
}

function countBy<T>(games: ShelfGame[], pick: (g: ShelfGame) => T[]): Map<T, number> {
  const m = new Map<T, number>();
  for (const g of games) for (const v of new Set(pick(g))) m.set(v, (m.get(v) ?? 0) + 1);
  return m;
}

/** Platform slugs by how much of the collection is on them. */
function platformsByCount(games: ShelfGame[], min: number): string[] {
  const counts = countBy(games, (g) => g.copies.map((c) => c.platform));
  return [...counts].filter(([, n]) => n >= min).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([slug]) => slug);
}

/**
 * Tags by how many games carry them, perspectives excluded: "Side view games
 * on the NES" describes a rendering technique, not a kind of evening.
 */
function tagsByCount(games: ShelfGame[], min: number): string[] {
  const perspectives = new Set<string>();
  for (const g of games) for (const p of g.perspectives) perspectives.add(tagKey(p));
  const counts = new Map<string, { tag: string; n: number }>();
  for (const g of games) {
    for (const t of g.tags) {
      if (perspectives.has(t.key)) continue;
      const cur = counts.get(t.key) ?? { tag: t.tag, n: 0 };
      cur.n++;
      counts.set(t.key, cur);
    }
  }
  return [...counts.values()]
    .filter((t) => t.n >= min && tagPhrase(t.tag) != null)
    .sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag))
    .map((t) => t.tag);
}

const PLAYER_ROWS: { key: string; title: string; patch: Partial<Filters> }[] = [
  { key: "players:2-coop", title: `${MODE_LABELS.coop} games for two`, patch: { players: 2, mode: "coop" } },
  { key: "players:4", title: "Four-player games", patch: { players: 4 } },
  { key: "players:versus", title: "Head-to-head games", patch: { mode: "versus" } },
  { key: "players:2-together", title: "Two of you, at the same time", patch: { players: 2, mode: "together" } },
  { key: "players:3", title: "Three-player games", patch: { players: 3 } },
  { key: "players:2", title: "Two-player games", patch: { players: 2 } },
];

const ERAS: NonNullable<Filters["era"]>[] = ["80s", "90s", "00s", "10s"];

/**
 * Every row this collection could offer, in a stable order. The day's seed
 * shuffles this pool and the gates pick from the front of it, so a bigger
 * collection simply has a bigger pool to be surprising from.
 */
export function candidateRows(games: ShelfGame[], series: HomeSeries[], minRow: number): Candidate[] {
  const out: Candidate[] = [];
  // Crosses are offered only for platforms big enough to survive one; the
  // platform-alone rows go down to two, because those are the broad fallbacks a
  // small or narrow collection is filled with when nothing else qualifies.
  const platforms = platformsByCount(games, Math.min(minRow, 2));
  const bigPlatforms = platformsByCount(games, minRow);
  const tags = tagsByCount(games, minRow);
  const topPlatforms = bigPlatforms.slice(0, 14);
  const topTags = tags.slice(0, 14);

  for (const p of topPlatforms) {
    for (const t of topTags) {
      out.push({
        key: `tag-platform:${tagKey(t)}:${p}`,
        kind: "tag-platform",
        title: `${cap(tagPhrase(t)!)} games on ${platformPhrase(p)}`,
        filters: withFilters({ tags: [t], platforms: [p] }),
        facets: [`platform:${p}`, `tag:${tagKey(t)}`],
      });
    }
  }
  for (const t of tags.slice(0, 16)) {
    out.push({ key: `tag:${tagKey(t)}`, kind: "tag", title: `More ${tagPhrase(t)!} games`, filters: withFilters({ tags: [t] }), facets: [`tag:${tagKey(t)}`] });
  }
  for (const r of PLAYER_ROWS) {
    out.push({ key: r.key, kind: "players", title: r.title, filters: withFilters(r.patch), facets: ["players"] });
  }
  for (const era of ERAS) {
    out.push({ key: `era:${era}`, kind: "era", title: `Your ${ERA_LABEL[era]} shelf`, filters: withFilters({ era }), facets: [`era:${era}`] });
  }
  for (const p of platforms) {
    out.push({ key: `platform:${p}`, kind: "platform", title: `Everything on ${platformPhrase(p)}`, filters: withFilters({ platforms: [p] }), facets: [`platform:${p}`], fallback: !bigPlatforms.includes(p) });
  }
  // Play state (GAMEEXPLOR-0009). Offered unconditionally; the whole-shelf gate
  // is what makes an empty play log safe. `play=never` then matches everything,
  // so this row would otherwise render as the entire collection under a title
  // that promises a selection (see MAX_ROW_SHARE).
  out.push({ key: "never", kind: "never-played", title: "You have never played these", filters: withFilters({ play: "never" }), facets: ["play"] });
  for (const p of topPlatforms.slice(0, 6)) {
    out.push({ key: `never:${p}`, kind: "never-played", title: `Never played on ${platformPhrase(p)}`, filters: withFilters({ play: "never", platforms: [p] }), facets: ["play", `platform:${p}`] });
  }
  // Series (GAMEEXPLOR-0011). The games are the series' own owned entries, in
  // series order, so the row reads as the series does — and the header goes to
  // the series page, which is the view that also shows what is missing.
  const byOwnedId = new Map<string, ShelfGame>();
  for (const g of games) for (const c of g.copies) byOwnedId.set(c.ownedId, g);
  for (const s of series) {
    const owned: ShelfGame[] = [];
    for (const id of s.ownedIds) {
      const g = byOwnedId.get(id);
      if (g && !owned.includes(g)) owned.push(g);
    }
    out.push({ key: `series:${s.slug}`, kind: "series", title: `Every ${s.name}`, href: `/series/${s.slug}`, games: owned, facets: [`series:${s.slug}`] });
  }
  return out;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ------------------------------------------------------------------ selection */

/** A tier of gates. `null` switches a gate off for a fallback pass. */
type Gates = { minRow: number; maxPerGame: number | null; maxOverlap: number | null; maxShare: number | null; maxPerKind: number | null; maxPerFacet: number | null };

/**
 * Two rows are the same row twice when they are mostly the same games
 * (Jaccard) *or* when one is essentially a subset of the other (containment) —
 * a strict subset can score low on Jaccard while showing the reader nothing
 * new.
 */
export function nearIdentical(a: Set<string>, b: Set<string>, maxOverlap: number, maxContainment = MAX_CONTAINMENT): boolean {
  if (!a.size || !b.size) return false;
  let shared = 0;
  for (const id of a) if (b.has(id)) shared++;
  const jaccard = shared / (a.size + b.size - shared);
  const containment = shared / Math.min(a.size, b.size);
  return jaccard > maxOverlap || containment > maxContainment;
}

/** A small string hash, so each row shuffles its own way but always the same way. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function buildHomeRows(games: ShelfGame[], opts: HomeOptions = {}): HomeRow[] {
  const { date = new Date(), series = [], rows: target = HOME_ROWS, minRow = MIN_ROW, rowSize = ROW_SIZE, maxPerGame = MAX_ROWS_PER_GAME, maxOverlap = MAX_OVERLAP } = opts;
  if (!games.length) return [];
  const seed = daySeed(date);
  const pool = candidateRows(games, series, minRow);
  const source = new Map<string, ShelfGame[]>();
  const resolve = (c: Candidate): ShelfGame[] => {
    const cached = source.get(c.key);
    if (cached) return cached;
    const list = c.games ?? applyFilters(games, c.filters!).confirmed;
    source.set(c.key, list);
    return list;
  };

  const chosen: HomeRow[] = [];
  const chosenSets: Set<string>[] = [];
  const taken = new Set<string>();
  const shown = new Map<string, number>();
  const perKind = new Map<HomeRowKind, number>();
  const perFacet = new Map<string, number>();

  const consider = (c: Candidate, gates: Gates): boolean => {
    const { minRow: min, maxPerGame: perGame, maxOverlap: overlap, maxShare, maxPerKind: perKindMax, maxPerFacet: perFacetMax } = gates;
    if (chosen.length >= target || taken.has(c.key)) return false;
    if (perKindMax != null && (perKind.get(c.kind) ?? 0) >= perKindMax) return false;
    if (perFacetMax != null && c.facets.some((f) => (perFacet.get(f) ?? 0) >= perFacetMax)) return false;
    const all = resolve(c);
    if (all.length < min) return false;
    // Nearly the whole shelf is not a row (see MAX_ROW_SHARE). Off in the
    // fallback passes, where "Everything on the NES" *is* the answer for a
    // one-platform collection.
    if (maxShare != null && all.length > games.length * maxShare) return false;
    const ids = new Set(all.map((g) => g.id));
    if (overlap != null && chosenSets.some((s) => nearIdentical(ids, s, overlap))) return false;
    // A series keeps its own order; everything else is a seeded pick of the
    // filter's result, so two rows over overlapping sets do not open with the
    // same three covers.
    const ordered = c.kind === "series" ? all : seededShuffle(all, (seed ^ hash(c.key)) >>> 0);
    const list = (perGame == null ? ordered : ordered.filter((g) => (shown.get(g.id) ?? 0) < perGame)).slice(0, rowSize);
    if (list.length < min) return false;
    chosen.push({ key: c.key, kind: c.kind, title: c.title, href: c.href ?? `/shelf${serializeFilters(c.filters!)}`, games: list, total: all.length });
    chosenSets.push(ids);
    taken.add(c.key);
    perKind.set(c.kind, (perKind.get(c.kind) ?? 0) + 1);
    for (const f of c.facets) perFacet.set(f, (perFacet.get(f) ?? 0) + 1);
    for (const g of list) shown.set(g.id, (shown.get(g.id) ?? 0) + 1);
    return true;
  };

  const shuffled = seededShuffle(pool, seed).filter((c) => !c.fallback);
  // At most two rows of a kind and two leaning on the same platform or tag, so
  // a page is never three "Everything on ..." rows in a row.
  const strict: Gates = { minRow, maxPerGame, maxOverlap, maxShare: MAX_ROW_SHARE, maxPerKind: 2, maxPerFacet: 2 };
  for (const c of shuffled) consider(c, strict);
  // Same pool, without the variety caps: a collection that is all one platform
  // should still get a full page.
  if (chosen.length < target) for (const c of shuffled) consider(c, { ...strict, maxPerKind: null, maxPerFacet: null });

  // Deterministic fallbacks — the broadest rows there are, in a fixed order,
  // with the gates dropped one at a time. Not shuffled: when the interesting
  // rows cannot be built, predictable beats surprising.
  if (chosen.length < target) {
    const broad = pool.filter((c) => c.kind === "platform" || c.kind === "era");
    for (const gates of [
      { minRow, maxPerGame, maxOverlap: null, maxShare: null, maxPerKind: null, maxPerFacet: null },
      { minRow: Math.min(minRow, 4), maxPerGame: null, maxOverlap: null, maxShare: null, maxPerKind: null, maxPerFacet: null },
      { minRow: 2, maxPerGame: null, maxOverlap: null, maxShare: null, maxPerKind: null, maxPerFacet: null },
    ] satisfies Gates[]) {
      if (chosen.length >= target) break;
      for (const c of broad) consider(c, gates);
    }
  }
  // Last resort: a collection too small for any combination still has itself.
  if (!chosen.length) {
    consider(
      { key: "all", kind: "platform", title: "Everything you own", filters: withFilters({}), facets: [] },
      { minRow: 1, maxPerGame: null, maxOverlap: null, maxShare: null, maxPerKind: null, maxPerFacet: null },
    );
  }
  return chosen;
}
