"use client";

import Link from "next/link";
import { useCallback, useState, type ReactNode } from "react";
import { activeFilterCount, type Facets, type Filters } from "@/lib/filters";
import type { Viewer } from "@/lib/viewer";
import { Button, cx } from "@/components/ui";
import { focusTrigger } from "@/components/overlay";
import { FilterSheet } from "@/components/shelf/filter-sheet";
import { useDebouncedQuery } from "@/components/shelf/use-filters";

/**
 * The reduced filter toolbar for surfaces that are not the shelf: a search
 * box, the `Filters · N` button that opens the shelf's own `<FilterSheet>`,
 * and a scrolling row of the top genres as one-tap chips.
 *
 * **This deliberately does not replace the shelf's toolbar, and the shelf was
 * deliberately not refactored onto it.** The shelf's carries three things that
 * only make sense there — the preset row, the covers/list toggle, and the Flip
 * call to action — and it is `sticky top-12` over a page that scrolls for
 * screens. Converging the two would mean growing five props whose only job is
 * to switch pieces off, which is how a shared component becomes worse than the
 * duplication. A later ticket can do it properly; until then the overlap here
 * is a copy on purpose, not an oversight.
 *
 * Presets are off in the sheet for the same reason: "Never played" and "2 of
 * us, co-op" are ways *into* the shelf, and a page whose sections already are
 * play state has nothing to do with them.
 */
export function FilterBar({
  filters,
  set,
  reset,
  facets,
  viewer,
  confirmed,
  maybe,
  placeholder = "Search",
  children,
}: {
  filters: Filters;
  set: (patch: Partial<Filters>) => void;
  reset: () => void;
  facets: Facets;
  viewer: Viewer;
  /** Rows this filter confirms, for the sheet's "Show N" button. */
  confirmed: number;
  /** Rows with no data either way, shown behind the confirmed ones. */
  maybe: number;
  placeholder?: string;
  /** Slot for one surface-specific control, beside the Filters button. */
  children?: ReactNode;
}) {
  const [query, setQuery] = useDebouncedQuery(filters.q, set);
  // Already trimmed: `parseFilters` does it on the way out of the URL.
  const term = filters.q;
  const [sheetOpen, setSheetOpen] = useState(false);
  const closeSheet = useCallback(() => setSheetOpen(false), []);
  const active = activeFilterCount(filters);

  return (
    <div className="-mx-4 px-4">
      <div className="flex items-center gap-2">
        <label className="relative flex-1">
          <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-faint">⌕</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder}
            aria-label="Search"
            className="h-11 w-full rounded-xl border border-border bg-surface pl-9 pr-3 text-base outline-none placeholder:text-faint focus:border-accent"
          />
        </label>
        <Button variant={active ? "primary" : "secondary"} onClick={(e) => {
            focusTrigger(e);
            setSheetOpen(true);
          }} data-testid="open-filters" aria-expanded={sheetOpen}>
          Filters{active ? ` · ${active}` : ""}
        </Button>
        {children}
      </div>
      {/* The escape hatch, and the whole answer to "which search is this?"
          (GAMEEXPLOR-0027). The box above filters *this page* — the placeholder
          says which page — and the moment you type something, this line offers
          the same words against the whole collection. A scope toggle was the
          obvious alternative and is the thing that would make both boxes
          ambiguous: a mode you can leave switched on is a mode you forget is
          on. A link is not a mode. */}
      {term ? (
        <div className="mt-2 text-sm">
          <Link href={`/shelf?q=${encodeURIComponent(term)}`} prefetch={false} className="text-accent-2 hover:underline" data-testid="search-all-games">
            Search all games for “{term}” <span aria-hidden>→</span>
          </Link>
        </div>
      ) : null}
      {/* Plays like: the top genres as one-tap toggles; the sheet has the rest.
          Same chips as the shelf's, so the gesture is the same everywhere. */}
      {facets.genres.length ? (
        <div className="scrollbar-none -mx-4 mt-2 flex gap-1.5 overflow-x-auto px-4" data-testid="genre-row">
          {facets.genres.slice(0, 12).map((g) => {
            const on = filters.tags.includes(g.name);
            return (
              <button
                key={g.name}
                onClick={() => set({ tags: on ? filters.tags.filter((t) => t !== g.name) : [...filters.tags, g.name] })}
                aria-pressed={on}
                className={cx("min-h-11 shrink-0 rounded-full border px-3 text-sm transition touch-manipulation", on ? "border-accent-2 bg-accent-2/15 text-accent-2 font-semibold" : "border-border/60 bg-bg-elev text-muted hover:text-text")}
                data-testid="genre-chip"
              >
                {g.name}
              </button>
            );
          })}
        </div>
      ) : null}
      <FilterSheet open={sheetOpen} onClose={closeSheet} filters={filters} facets={facets} set={set} reset={reset} active={active} confirmed={confirmed} maybe={maybe} showPresets={false} viewer={viewer} />
    </div>
  );
}
