"use client";

import Link from "next/link";
import { useCallback, useMemo } from "react";
import type { SeriesEntryView } from "@/lib/series/service";
import type { Viewer } from "@/lib/viewer";
import { activeFilterCount, facets as buildFacets, parseFilters, serializeFilters, splitInOrder, type Filters } from "@/lib/filters";
import { missingHref, parseMissing } from "@/lib/series/shape";
import { Badge, Button, cx } from "@/components/ui";
import { Cover } from "@/components/shelf/cover";
import { GameCard } from "@/components/shelf/game-card";
import { FilterBar } from "@/components/filters/filter-bar";
import { useFilters } from "@/components/shelf/use-filters";

export type SeriesSection = { section: string | null; entries: SeriesEntryView[] };

/**
 * One series as the shelf's grid, in the series' own order (GAMEEXPLOR-0016).
 *
 * It looks like the shelf because it is the shelf: the same `GameCard` at the
 * same size in the same grid, filtered by the same `Filters` through the same
 * `verdictFor`. Every entry carries a `ShelfGame` for exactly that reason —
 * see `withShelfGames` in src/lib/series/service.ts — including the ones
 * nobody owns, which get a synthesised one so "NES" and "co-op" mean something
 * on a page whose point is showing you the gaps.
 *
 * Two things the shelf has are deliberately absent. There is no sort control,
 * and `sortGames` is nowhere in this file: the curated `position` is the whole
 * content of a series, and a page that let you re-sort Final Fantasy
 * alphabetically would have thrown away the only thing it knows. And the
 * `?missing` toggle is not a filter — it is a page-level searchParam resolved
 * on the server (see src/lib/series/shape.ts), so it stays a `<Link>` while
 * everything beside it is client-side state written straight into the URL.
 * The link carries the current filters, so `?missing=1&platform=nes` is one
 * view you can send someone.
 */
export function SeriesGrid({ slug, owned, total, missing, sections, viewer }: { slug: string; owned: number; total: number; missing: boolean; sections: SeriesSection[]; viewer: Viewer }) {
  const [filters, setFilters, resetFilters] = useFilters();
  const active = activeFilterCount(filters);
  /**
   * `useFilters` rewrites the URL from `Filters` alone, which is right
   * everywhere else and would drop `?missing=1` here — the shelf has no
   * page-level params to lose. So every filter change puts it back, in the
   * same gesture rather than from an effect: the rule is that the URL is only
   * rewritten when the user does something, and this *is* that write finished.
   * Without it, filtering the missing view would leave a URL that reloads as
   * the owned view — a link that shows something other than the page you sent.
   */
  const keepMissing = useCallback(() => {
    // Read `missing` off the live URL, not the prop. The prop only updates when
    // the server component re-renders, so for the whole of the toggle's client
    // navigation it still says `false` — and a filter change landing in that
    // window would rewrite the URL without `missing=1` while the missing
    // entries are still on screen, leaving a link that reloads as a different
    // page than the one you are looking at.
    const search = new URLSearchParams(window.location.search);
    if (!parseMissing(search)) return;
    const qs = serializeFilters(parseFilters(search));
    window.history.replaceState(null, "", `${window.location.pathname}?missing=1${qs ? `&${qs.slice(1)}` : ""}`);
  }, []);
  const set = useCallback(
    (patch: Partial<Filters>) => {
      setFilters(patch);
      keepMissing();
    },
    [setFilters, keepMissing],
  );
  // Clearing the filters is not leaving the missing view: it is not a filter.
  const reset = useCallback(() => {
    resetFilters();
    keepMissing();
  }, [resetFilters, keepMissing]);
  // Facets over everything this view shows *before* filtering, so picking NES
  // never removes SNES from the sheet you would pick it back with. In the
  // default view that is the owned entries only — which is what makes the
  // platform list here the shelf's, and the `?missing=1` list "released on".
  const entries = useMemo(() => sections.flatMap((g) => g.entries), [sections]);
  const facets = useMemo(() => buildFacets(entries.map((e) => e.game)), [entries]);
  // `splitInOrder`, never `applyFilters`: the latter re-sorts. `kept` is the
  // curated order with the could-work entries left where they belong, dimmed
  // in place rather than swept to the end of their section — the same
  // treatment /playing gives its two ordered lists.
  const groups = useMemo(
    () =>
      sections
        .map((g) => ({ section: g.section, ...splitInOrder(g.entries, filters) }))
        .filter((g) => g.kept.length),
    [sections, filters],
  );
  const shown = groups.reduce((n, g) => n + g.kept.length, 0);
  const maybe = groups.reduce((n, g) => n + g.maybe.length, 0);
  const dim = useMemo(() => new Set(groups.flatMap((g) => g.maybe.map((e) => e.id))), [groups]);
  const named = sections.some((g) => g.section);
  // Cover priority is the first screenful of the page, not of each section.
  let drawn = 0;

  return (
    <>
      {/* The count line IS the control — one tap, thumb-sized, and it changes
          the URL rather than some hidden state. An empty series has nothing to
          reveal, so it gets no control at all rather than "0 of 0". */}
      {total ? (
        <Link
          href={missingHref(slug, !missing, serializeFilters(filters))}
          prefetch={false}
          scroll={false}
          className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl border border-border bg-surface px-4 text-sm transition hover:border-muted"
          data-testid="missing-toggle"
        >
          <span className="tabular-nums">
            You own <span className="font-semibold text-text">{owned}</span> of {total}
          </span>
          <span className="text-accent-2 underline">{missing ? "hide what I'm missing" : "show what I'm missing"}</span>
        </Link>
      ) : null}

      {entries.length ? (
        <div className="mt-4">
          <FilterBar filters={filters} set={set} reset={reset} facets={facets} viewer={viewer} confirmed={shown - maybe} maybe={maybe} filterLabel="Filter this series" />
        </div>
      ) : null}

      {shown ? (
        <div className="mt-6 flex flex-col gap-8" data-testid="series-entries">
          {groups.map((group) => (
            <section key={group.section ?? "__none"}>
              {named ? (
                <h2 className="mb-3 font-display text-sm font-bold uppercase tracking-[0.14em] text-muted">
                  {group.section ?? "Also"}
                  {active ? <span className="ml-2 font-normal normal-case tracking-normal text-faint">{group.kept.length} shown</span> : null}
                </h2>
              ) : null}
              <div className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))] sm:gap-x-4">
                {group.kept.map((entry) => (
                  <EntryCard key={entry.id} entry={entry} dim={dim.has(entry.id)} priority={drawn++ < 12} />
                ))}
              </div>
            </section>
          ))}
          {maybe ? (
            <p className="text-xs text-muted">
              {maybe === 1 ? "One dimmed game has" : `${maybe} dimmed games have`} no data either way.
            </p>
          ) : null}
        </div>
      ) : entries.length ? (
        // Hidden by a filter, not absent. Saying the series is empty here would
        // be a lie about the series rather than a fact about the filter.
        <div className="mt-8 rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted" data-testid="series-filtered-empty">
          <p>
            {entries.length === 1 ? "The one game here does not" : `None of the ${entries.length} games here`} match the filters.
          </p>
          <Button variant="ghost" className="mt-3" onClick={reset}>
            Clear filters
          </Button>
        </div>
      ) : total ? (
        <p className="mt-8 rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted" data-testid="series-none-owned">
          None of this series is on the shelf yet.{" "}
          {/* Carries the filters, like the toggle above: arriving here under
              `?platform=snes` and being sent to an unfiltered page is the one
              place a filter would silently vanish. */}
          <Link href={missingHref(slug, true, serializeFilters(filters))} className="text-accent-2 underline" prefetch={false}>
            Show all {total}
          </Link>
          .
        </p>
      ) : (
        // A series with no entries at all: "Show all 0" would link to the page
        // you are already on.
        <p className="mt-8 rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted" data-testid="series-empty">
          No entries yet.
        </p>
      )}
    </>
  );
}

/**
 * An owned entry is the shelf's own card, link and all; an unowned one is the
 * same card shape, dimmed and marked, in its right position in the order —
 * never a separate "missing" list, because seeing the gap where V should be is
 * the point.
 */
function EntryCard({ entry, dim, priority }: { entry: SeriesEntryView; dim: boolean; priority: boolean }) {
  if (entry.ownedId) {
    // The testid sits on the wrapper because `GameCard` is the anchor and takes
    // no passthrough props; the anchor inside it is what a click lands on.
    return (
      <div data-testid="series-entry-owned">
        <GameCard game={entry.game} dim={dim} priority={priority} />
      </div>
    );
  }
  return <MissingCard entry={entry} dim={dim} priority={priority} />;
}

/**
 * Not a link: there is no game page for a game you do not own. `GameCard` is
 * an anchor to `/game/<id>` all the way through, which is why this is a
 * separate card rather than a prop on it — and why it is here, beside its one
 * caller, instead of forked into the shelf's component.
 */
function MissingCard({ entry, dim, priority }: { entry: SeriesEntryView; dim: boolean; priority: boolean }) {
  return (
    <div className={cx("block animate-fade-up", dim && "opacity-70")} data-testid="series-entry-missing">
      <div className="relative">
        <Cover imageId={entry.cover} title={entry.name} priority={priority} className="opacity-50 shadow-lg shadow-black/40 ring-1 ring-border" />
        {/* Top left, where the shelf puts a platform label — which a card for a
            game you do not own never has. Bottom left is the cover fallback's
            own title, and the badge would sit on top of it. */}
        <Badge className="absolute left-2 top-2 backdrop-blur">not owned</Badge>
      </div>
      <div className="mt-2 px-0.5">
        <div className="line-clamp-2 text-sm font-medium leading-snug text-muted">{entry.name}</div>
        <div className="mt-0.5 truncate text-xs text-faint">
          {entry.year ?? "—"}
          {entry.note ? ` · ${entry.note}` : ""}
        </div>
      </div>
    </div>
  );
}
