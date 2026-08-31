/**
 * The pure half of bookmarks: kinds, the cap, and the dedupe key. No database,
 * so the client-side section can import it without dragging Prisma into the
 * bundle.
 */

/**
 * Five kinds, because a bookmark section is read by scanning headings. They
 * answer different questions — "how do I get past this" (guide), "what is the
 * exact damage formula" (wiki), "what does it look like played well"
 * (longplay), "why does this game matter" (article), "show me this bit"
 * (video) — and anything that fits two goes under the one you would open it
 * for.
 */
export const BOOKMARK_KINDS = ["guide", "wiki", "video", "longplay", "article"] as const;
export type BookmarkKind = (typeof BOOKMARK_KINDS)[number];

export function isBookmarkKind(k: string): k is BookmarkKind {
  return (BOOKMARK_KINDS as readonly string[]).includes(k);
}

/** Headings, in the order they read on the page. */
export const KIND_LABELS: Record<BookmarkKind, string> = {
  guide: "Guides & walkthroughs",
  wiki: "Wikis & references",
  video: "Video",
  longplay: "Longplays",
  article: "Reading",
};

/** Singular, for the "kind" picker in the add/edit form. */
export const KIND_OPTIONS: Record<BookmarkKind, string> = {
  guide: "Guide / walkthrough",
  wiki: "Wiki / reference",
  video: "Video",
  longplay: "Longplay",
  article: "Article",
};

/** Kinds sort by their position in BOOKMARK_KINDS, not alphabetically. */
export function kindRank(kind: string): number {
  const i = (BOOKMARK_KINDS as readonly string[]).indexOf(kind);
  return i === -1 ? BOOKMARK_KINDS.length : i;
}

/**
 * A shortlist per game, not a link dump. The cap is what keeps this a section
 * you skim on a phone and pick one thing from.
 */
export const MAX_BOOKMARKS_PER_GAME = 50;

/** Query keys that identify a campaign, not a page. Stripped before keying. */
const TRACKING = /^(utm_|fbclid$|gclid$|mc_[ce]id$|ref$|ref_src$|igshid$|si$)/i;

/**
 * Dedupe key: the same page saved twice is one row, however it was pasted.
 * Scheme, "www.", a trailing slash, the fragment and tracking query all go;
 * everything that can change which page you land on stays. Query parameters
 * are sorted so `?v=x&t=1` and `?t=1&v=x` key alike — YouTube's `v` is the
 * video, so it cannot simply be dropped.
 *
 * **Only the host is case-folded.** A path and a query value are
 * case-sensitive on the web — `?v=dQw4w9WgXcQ` and `/wiki/Contra_(video_game)`
 * are not the same pages as their lower-cased spellings — and folding the whole
 * key would collapse two different pages onto one row through the unique
 * (ownedGameId, urlKey).
 *
 * The sorted pairs are re-**encoded** rather than joined raw, because
 * `searchParams` hands them back decoded: `?q=hello%26v%3Dy` is one parameter
 * whose value contains "&v=", and joining it unescaped would key it the same
 * as the two-parameter `?q=hello&v=y`.
 *
 * Falls back to the raw trimmed string for anything `URL` cannot parse; the
 * schema rejects those before they get here, so it is belt and braces.
 */
export function urlKeyOf(url: string): string {
  const raw = url.trim();
  try {
    const u = new URL(raw);
    const host = u.host.toLowerCase().replace(/^www\./, "");
    const path = u.pathname.replace(/\/+$/, "");
    const params = [...u.searchParams.entries()].filter(([k]) => !TRACKING.test(k)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    const query = params.length ? `?${new URLSearchParams(params).toString()}` : "";
    return `${host}${path}${query}`;
  } catch {
    return raw;
  }
}

/** "gamefaqs.gamespot.com/nes/…" — what a row shows under its title. */
export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}
