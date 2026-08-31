/**
 * The pure half of series: slugs, the `?missing` toggle, section grouping and
 * the seed diff. No database and no Prisma, so a client component (the
 * /series/new pruning list) can import it without dragging the ORM into the
 * bundle.
 */

/** Enough for a 191-entry IGDB collection saved whole; a pruned series is ~20. */
export const MAX_ENTRIES_PER_SERIES = 300;

/** A series blurb is one line — the same stance as GAMEEXPLOR-0010: source and cite, do not author prose. */
export const MAX_BLURB = 200;

/**
 * "Final Fantasy" → "final-fantasy". Accents are folded so "Pokémon" keys as
 * "pokemon", and everything that is not a letter or digit becomes one hyphen.
 */
export function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/g, "");
}

/**
 * `slug`, or `slug-2`, `slug-3`… — the first spelling `taken` does not hold.
 * A name that slugifies to nothing at all ("???") falls back to "series".
 */
export function uniqueSlug(name: string, taken: Iterable<string>): string {
  const base = slugify(name) || "series";
  const used = new Set(taken);
  if (!used.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${base}-${n}`;
    if (!used.has(candidate)) return candidate;
  }
  // A thousand series of one name is not a real case, but the escape hatch
  // still has to fit the 80-char column the slug is stored in: trim the base,
  // not the suffix that makes it unique.
  const suffix = `-${Date.now()}`;
  return `${base.slice(0, 80 - suffix.length).replace(/-+$/g, "")}${suffix}`;
}

/**
 * The series page defaults to what you own; `?missing=1` reveals the rest.
 *
 * A page-level searchParam on purpose, NOT a field of `Filters` in
 * src/lib/filters.ts, even though since GAMEEXPLOR-0016 the rest of that page
 * *is* the shelf's filters. The two are different kinds of thing: a `Filters`
 * field narrows a set of games the browser already holds, and every one of
 * them is three-valued against sparse IGDB data. This decides which games the
 * **server** sends at all — a game nobody owns is not an unknown, it is a
 * different question — so it is resolved per URL when the page renders and the
 * grid never sees it. Both live in the URL, per the linkability invariant:
 * "what am I missing, on the NES" is one view you can send to someone.
 */
export function parseMissing(params: URLSearchParams | Record<string, string | string[] | undefined> | undefined): boolean {
  if (!params) return false;
  const raw = params instanceof URLSearchParams ? params.get("missing") : Array.isArray(params.missing) ? params.missing[0] : params.missing;
  return raw === "1" || raw === "true";
}

/**
 * The href that flips the toggle. Dropping the param entirely is the default
 * view.
 *
 * `query` is the rest of the URL the page is wearing — the shelf's filters,
 * which the series page keeps in the URL client-side (GAMEEXPLOR-0016). They
 * ride along so that asking what you are missing keeps the platform you had
 * picked, and `?missing=1&platform=nes` stays one linkable view. `missing`
 * comes first so the plain toggle is still exactly `?missing=1`.
 */
export function missingHref(slug: string, show: boolean, query = ""): string {
  const rest = query.replace(/^[?&]/, "");
  const params = [show ? "missing=1" : "", rest].filter(Boolean).join("&");
  return params ? `/series/${slug}?${params}` : `/series/${slug}`;
}

/**
 * Group entries under their `section`, in the order the sections first appear.
 * Entries keep their curated order inside a section; entries with no section
 * group under `null`, which the page renders without a heading.
 */
export function groupBySection<T extends { section: string | null }>(entries: T[]): { section: string | null; entries: T[] }[] {
  const groups: { section: string | null; entries: T[] }[] = [];
  for (const e of entries) {
    const key = e.section?.trim() || null;
    const g = groups.find((x) => x.section === key);
    if (g) g.entries.push(e);
    else groups.push({ section: key, entries: [e] });
  }
  return groups;
}

/**
 * Every id a candidate list *showed* — the primaries and the ports collapsed
 * into them. This, not the primaries alone, is what `seen` must record: IGDB
 * can drop a parent between two checks, and yesterday's variant then arrives as
 * its own candidate. Recording only primaries would re-offer it as new.
 */
export function seenIdsOf(candidates: { igdbId: number; variants: { igdbId: number }[] }[]): number[] {
  return [...new Set(candidates.flatMap((c) => [c.igdbId, ...c.variants.map((v) => v.igdbId)]))];
}

/**
 * "New since the last prune": ids in the collection now that the owner has
 * neither kept nor already turned down.
 *
 * `seen` is why this is honest. Storing only the entries would report every
 * one of the 170 unticked ports as "new" on every check; storing the
 * collection and treating entries as an exclusion list would let IGDB rewrite
 * the page. `seen` records what has been *shown*, so a deliberate no stays no,
 * while an entry added by hand (never shown, but present) is covered by the
 * union with the current entry ids.
 */
export function newSinceLastPrune(collectionIds: number[], seen: number[], entryIgdbIds: number[]): number[] {
  const known = new Set<number>([...seen, ...entryIgdbIds]);
  return collectionIds.filter((id) => !known.has(id));
}
