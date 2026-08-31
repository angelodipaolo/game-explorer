import type { ShelfGame } from "./collection";
import { tagKey } from "./tags";

/**
 * Filter state lives in the URL so any view is a link. Every filter is
 * three-valued against sparse data: a game is CONFIRMED, EXCLUDED, or
 * UNKNOWN (no data either way). Unknowns are shown, separately, unless
 * `strict` is on.
 *
 * `play` is the one exception and is two-valued — it reads your own play log,
 * not IGDB, so there is no "no data either way" to represent. See
 * `playVerdict`.
 */
export type Filters = {
  q: string;
  /** Platform slugs; empty = any. Several at once is normal ("NES or SNES"). */
  platforms: string[];
  /** Hide games whose owned copies are exclusively on handheld-only systems. */
  hideHandhelds: boolean;
  /** How many of us are playing. */
  players: number | null;
  /** coop | versus | together (simultaneous) */
  mode: "coop" | "versus" | "together" | null;
  /** "Plays like" tags — genres, perspectives, themes. A game must carry ALL of them. */
  tags: string[];
  /** quick (< 1h) | evening (1–4h) | long (> 4h) */
  length: "quick" | "evening" | "long" | null;
  era: "80s" | "90s" | "00s" | "10s" | null;
  /** Have you played it? Two-valued, unlike everything else here — see playVerdict. */
  play: "playing" | "played" | "never" | null;
  strict: boolean;
  view: "grid" | "list";
  sort: "title" | "year" | "rating" | "shuffle";
  /** Shuffle seed so a shared link shows the same order. */
  seed: number | null;
};

export const DEFAULT_FILTERS: Filters = { q: "", platforms: [], hideHandhelds: false, players: null, mode: null, tags: [], length: null, era: null, play: null, strict: false, view: "grid", sort: "title", seed: null };

/** Hybrid systems such as Switch are intentionally not in this set. */
export const HANDHELD_ONLY_PLATFORMS = new Set(["gb", "gbc", "gba", "ds", "3ds", "psp", "vita"]);

export function parseFilters(params: URLSearchParams | Record<string, string | string[] | undefined>): Filters {
  const get = (k: string): string | null => {
    if (params instanceof URLSearchParams) return params.get(k);
    const v = params[k];
    return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
  };
  const players = Number(get("players"));
  const mode = get("mode");
  const length = get("length");
  const era = get("era");
  const play = get("play");
  const view = get("view");
  const sort = get("sort");
  const seed = Number(get("seed"));
  return {
    q: (get("q") ?? "").trim(),
    platforms: [...new Set((get("platform") ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean))],
    hideHandhelds: get("handhelds") === "hide",
    players: players >= 1 && players <= 8 ? players : null,
    mode: mode === "coop" || mode === "versus" || mode === "together" ? mode : null,
    tags: [...new Set(`${get("tags") ?? ""},${get("genre") ?? ""}`.split(",").map((s) => s.trim()).filter(Boolean))],
    length: length === "quick" || length === "evening" || length === "long" ? length : null,
    era: era === "80s" || era === "90s" || era === "00s" || era === "10s" ? era : null,
    play: play === "playing" || play === "played" || play === "never" ? play : null,
    strict: get("strict") === "1",
    view: view === "list" ? "list" : "grid",
    sort: sort === "year" || sort === "rating" || sort === "shuffle" ? sort : "title",
    seed: Number.isFinite(seed) && seed > 0 ? seed : null,
  };
}

export function serializeFilters(f: Partial<Filters>): string {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.platforms?.length) p.set("platform", f.platforms.join(","));
  if (f.hideHandhelds) p.set("handhelds", "hide");
  if (f.players) p.set("players", String(f.players));
  if (f.mode) p.set("mode", f.mode);
  if (f.tags?.length) p.set("tags", f.tags.join(","));
  if (f.length) p.set("length", f.length);
  if (f.era) p.set("era", f.era);
  if (f.play) p.set("play", f.play);
  if (f.strict) p.set("strict", "1");
  if (f.view && f.view !== "grid") p.set("view", f.view);
  if (f.sort && f.sort !== "title") p.set("sort", f.sort);
  if (f.seed) p.set("seed", String(f.seed));
  const s = p.toString().replace(/%2C/g, ",");
  return s ? `?${s}` : "";
}

export function activeFilterCount(f: Filters): number {
  return [f.q, f.platforms.length ? f.platforms : null, f.hideHandhelds, f.players, f.mode, f.tags.length ? f.tags : null, f.length, f.era, f.play].filter(Boolean).length;
}

export function gameTags(g: ShelfGame): Set<string> {
  return new Set(g.tags.map((t) => t.key));
}

export type Verdict = "yes" | "no" | "unknown";

function and(...vs: Verdict[]): Verdict {
  if (vs.includes("no")) return "no";
  if (vs.includes("unknown")) return "unknown";
  return "yes";
}

export function playersVerdict(g: ShelfGame, n: number): Verdict {
  const p = g.players;
  if (n <= 1) return p.single === false ? "no" : p.single === true ? "yes" : "unknown";
  if (p.max != null) return p.max >= n ? "yes" : "no";
  if (p.multiplayer === false) return "no";
  if (n === 2 && (p.multiplayer === true || p.coop === true)) return "yes";
  return "unknown";
}

export function modeVerdict(g: ShelfGame, mode: NonNullable<Filters["mode"]>): Verdict {
  const p = g.players;
  if (p.multiplayer === false) return "no";
  if (mode === "coop") return p.coop == null ? "unknown" : p.coop ? "yes" : "no";
  if (mode === "together") return p.simultaneous == null ? "unknown" : p.simultaneous ? "yes" : "no";
  // versus: multiplayer that is not only co-op
  if (p.multiplayer === true && p.coop !== true) return "yes";
  if (p.multiplayer === true && p.coop === true) return "unknown";
  return "unknown";
}

export function lengthVerdict(g: ShelfGame, length: NonNullable<Filters["length"]>): Verdict {
  const m = g.playtime;
  if (m == null) return "unknown";
  if (length === "quick") return m < 60 ? "yes" : "no";
  if (length === "evening") return m >= 60 && m <= 240 ? "yes" : "no";
  return m > 240 ? "yes" : "no";
}

export function eraVerdict(g: ShelfGame, era: NonNullable<Filters["era"]>): Verdict {
  if (g.year == null) return "unknown";
  const decade = era === "80s" ? 1980 : era === "90s" ? 1990 : era === "00s" ? 2000 : 2010;
  return g.year >= decade && g.year < decade + 10 ? "yes" : "no";
}

/**
 * **Two-valued on purpose: this never returns `unknown`.** Every other verdict
 * here is three-valued because IGDB's data is sparse and a missing field must
 * not read as a "no". Play state is not IGDB data and is not sparse: it is
 * derived from a log only you write, so "no sessions" means you have never
 * played it — a fact, not a gap. Do not "fix" this by adding an unknown branch;
 * a shelf where never-played games land in the "could work" pile is the exact
 * thing this filter exists to avoid.
 *
 * The three statuses partition the shelf, deliberately: a replay is a game
 * being played *again*, so its status is `playing`, and `play=played`
 * therefore means "played before, not currently" rather than "has ever been
 * played". That is the useful reading of each — "what am I in the middle of",
 * "what could I come back to", "what have I never started" — and it is why
 * this is an equality check and not a set of overlapping tests.
 */
export function playVerdict(g: ShelfGame, want: NonNullable<Filters["play"]>): Verdict {
  return g.play.status === want ? "yes" : "no";
}

export function verdictFor(g: ShelfGame, f: Filters): Verdict {
  const vs: Verdict[] = [];
  if (f.q) {
    const q = f.q.toLowerCase();
    vs.push(g.title.toLowerCase().includes(q) || g.name.toLowerCase().includes(q) || g.genres.some((x) => x.toLowerCase().includes(q)) ? "yes" : "no");
  }
  if (f.platforms.length) vs.push(g.copies.some((c) => f.platforms.includes(c.platform)) ? "yes" : "no");
  if (f.hideHandhelds) vs.push(g.copies.length > 0 && g.copies.every((c) => HANDHELD_ONLY_PLATFORMS.has(c.platform)) ? "no" : "yes");
  if (f.tags.length) {
    const have = gameTags(g);
    vs.push(f.tags.every((t) => have.has(tagKey(t))) ? "yes" : "no");
  }
  if (f.players) vs.push(playersVerdict(g, f.players));
  if (f.mode) vs.push(modeVerdict(g, f.mode));
  if (f.length) vs.push(lengthVerdict(g, f.length));
  if (f.era) vs.push(eraVerdict(g, f.era));
  if (f.play) vs.push(playVerdict(g, f.play));
  return and(...vs);
}

/** Deterministic shuffle so a shared link shows the same order on every phone. */
export function seededShuffle<T>(xs: T[], seed: number): T[] {
  const out = [...xs];
  let s = seed >>> 0 || 1;
  const rnd = () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function sortGames(games: ShelfGame[], f: Filters): ShelfGame[] {
  if (f.sort === "shuffle") return seededShuffle(games, f.seed ?? 1);
  const by = [...games];
  if (f.sort === "year") by.sort((a, b) => (a.year ?? 9999) - (b.year ?? 9999) || a.name.localeCompare(b.name));
  else if (f.sort === "rating") by.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1) || a.name.localeCompare(b.name));
  else by.sort((a, b) => sortKey(a.name).localeCompare(sortKey(b.name)));
  return by;
}

function sortKey(name: string): string {
  return name.replace(/^(the|a|an)\s+/i, "").toLowerCase();
}

export type FilterResult = { confirmed: ShelfGame[]; maybe: ShelfGame[]; excluded: number };

export function applyFilters(games: ShelfGame[], f: Filters): FilterResult {
  const confirmed: ShelfGame[] = [];
  const maybe: ShelfGame[] = [];
  let excluded = 0;
  for (const g of games) {
    const v = verdictFor(g, f);
    if (v === "yes") confirmed.push(g);
    else if (v === "unknown" && !f.strict) maybe.push(g);
    else excluded++;
  }
  return { confirmed: sortGames(confirmed, f), maybe: sortGames(maybe, f), excluded };
}

export type TagFacet = { name: string; count: number };
export type Facets = { platforms: { slug: string; label: string; count: number }[]; genres: TagFacet[]; perspectives: TagFacet[]; themes: TagFacet[]; yours: TagFacet[] };

export function facets(games: ShelfGame[]): Facets {
  const p = new Map<string, { label: string; count: number }>();
  const count = (pick: (g: ShelfGame) => string[]) => {
    const m = new Map<string, number>();
    for (const game of games) for (const t of pick(game)) m.set(t, (m.get(t) ?? 0) + 1);
    return [...m].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  };
  for (const game of games) {
    for (const c of game.copies) {
      const cur = p.get(c.platform) ?? { label: c.platformLabel, count: 0 };
      cur.count++;
      p.set(c.platform, cur);
    }
  }
  return {
    platforms: [...p].map(([slug, v]) => ({ slug, ...v })).sort((a, b) => b.count - a.count),
    genres: count((g) => g.tags.filter((t) => t.source === "igdb" && g.genres.includes(t.tag)).map((t) => t.tag)),
    perspectives: count((g) => g.tags.filter((t) => t.source === "igdb" && g.perspectives.includes(t.tag)).map((t) => t.tag)),
    themes: count((g) => g.tags.filter((t) => t.source === "igdb" && g.themes.includes(t.tag)).map((t) => t.tag)),
    yours: count((g) => g.tags.filter((t) => t.source !== "igdb").map((t) => t.tag)),
  };
}

/** Six picks that change daily but match on every phone in the room. */
export function tonightsPicks(games: ShelfGame[], date = new Date(), n = 6): ShelfGame[] {
  const seed = Number(`${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`);
  return seededShuffle(games.filter((g) => g.cover), seed).slice(0, n);
}
