/**
 * Title normalization used for dedupe keys and for matching against IGDB.
 */

/** Dedupe key: lowercase, ASCII, punctuation gone, whitespace collapsed. */
export function normalizeTitle(title: string): string {
  return title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\//g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** `Pac-Man [Tengen]` → `Pac-Man`; `Tetris (Tengen)` → `Tetris`. */
export function stripBrackets(title: string): string {
  return title
    .replace(/\s*\[[^\]]*\]/g, "")
    .replace(/\s*\([^)]*\)/g, "")
    .trim();
}

/** `Legend of Zelda, The` → `The Legend of Zelda`. */
export function unrotateArticle(title: string): string {
  const m = title.match(/^(.*),\s*(the|a|an)$/i);
  return m ? `${m[2]} ${m[1]}` : title;
}

const SEQUEL_LIKE = /^(\d+|i{1,3}|iv|v|vi{0,3}|ix|x)[:!.]?$/i;

/**
 * `Duck Tales 2` → `DuckTales 2`; `Star Tropics II: Zoda's Revenge` →
 * `StarTropics II: Zoda's Revenge`. Only the leading run of plain words is
 * joined, because that is where IGDB's spellings differ from the shelf's.
 */
export function collapseLeadingWords(title: string): string {
  const tokens = title.trim().split(/\s+/);
  let i = 0;
  while (i < tokens.length && /^[A-Za-z'’-]+$/.test(tokens[i]) && !SEQUEL_LIKE.test(tokens[i])) i++;
  if (i < 2) return title;
  return [tokens.slice(0, i).join(""), ...tokens.slice(i)].join(" ");
}

const STOPWORDS = new Set(["the", "a", "an", "of", "and"]);

/** Content words only, for "same words, different punctuation" comparisons. */
export function contentTokens(title: string): string[] {
  return normalizeTitle(title)
    .split(" ")
    .filter((t) => t && !STOPWORDS.has(t));
}

/** Space-free comparison key (so `Duck Tales` === `DuckTales`). */
export function compactKey(title: string): string {
  return normalizeTitle(title).replace(/\s+/g, "");
}

/** `Star Tropics II: Zoda's Revenge` → `Star Tropics II`. */
export function beforeSubtitle(title: string): string {
  const m = title.match(/^(.+?)\s*[:\u2013\u2014-]\s+.+$/);
  return m ? m[1] : title;
}

/**
 * Search terms to try, in order: raw title, bracket-stripped, article-fixed,
 * leading words collapsed, then the main title without its subtitle.
 * Deduplicated, case-insensitive.
 */
export function titleVariants(title: string): string[] {
  const out: string[] = [];
  const push = (s: string) => {
    const t = s.trim();
    if (t && !out.some((o) => o.toLowerCase() === t.toLowerCase())) out.push(t);
  };
  push(title);
  const stripped = stripBrackets(title);
  push(stripped);
  const unrotated = unrotateArticle(stripped);
  push(unrotated);
  push(collapseLeadingWords(unrotated));
  const main = beforeSubtitle(unrotated);
  if (main !== unrotated) {
    push(main);
    push(collapseLeadingWords(main));
  }
  return out;
}
