"use client";

import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import type { ShelfGame } from "@/lib/collection";
import { activeFilterCount, applyFilters, facets as buildFacets, serializeFilters, tonightsPicks, type Filters } from "@/lib/filters";
import { Button, cx } from "@/components/ui";
import { FilterSheet, PresetRow } from "./filter-sheet";
import { GameCard, GameRow } from "./game-card";
import { PlatformSidebar } from "./platform-sidebar";
import { useDebouncedQuery, useFilters, useScrollMemory } from "./use-filters";

export function Shelf({ games }: { games: ShelfGame[] }) {
  const [filters, set, reset] = useFilters({ scrollTopOnChange: true });
  const [query, setQuery] = useDebouncedQuery(filters.q, set);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [platformsOpen, setPlatformsOpen] = useState(false);
  const closeSheet = useCallback(() => setSheetOpen(false), []);
  const closePlatforms = useCallback(() => setPlatformsOpen(false), []);
  const facets = useMemo(() => buildFacets(games), [games]);
  const result = useMemo(() => applyFilters(games, filters), [games, filters]);
  const active = activeFilterCount(filters);
  const picks = useMemo(() => tonightsPicks(games), [games]);
  const qs = serializeFilters(filters);
  useScrollMemory(qs);


  return (
    <div className="mx-auto max-w-7xl px-4 pb-28 sm:pb-10">
      {/* Toolbar */}
      <div className="sticky top-12 z-20 -mx-4 bg-bg/85 px-4 py-3 backdrop-blur">
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setPlatformsOpen(true)} className={cx("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition", filters.platforms.length ? "border-accent bg-accent text-accent-ink" : "border-border bg-surface text-text hover:border-muted")} aria-label="Open platform menu" aria-expanded={platformsOpen} aria-controls="platform-menu" data-testid="open-platforms">
            <span className="grid w-5 gap-1" aria-hidden="true"><span className="h-0.5 bg-current" /><span className="h-0.5 bg-current" /><span className="h-0.5 bg-current" /></span>
          </button>
          <label className="relative flex-1">
            <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-faint">⌕</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search the shelf"
              aria-label="Search"
              className="h-11 w-full rounded-xl border border-border bg-surface pl-9 pr-3 text-base outline-none placeholder:text-faint focus:border-accent"
            />
          </label>
          <Button variant={active ? "primary" : "secondary"} onClick={() => setSheetOpen(true)} data-testid="open-filters" aria-expanded={sheetOpen}>
            Filters{active ? ` · ${active}` : ""}
          </Button>
          <div className="hidden overflow-hidden rounded-xl border border-border sm:flex" role="group" aria-label="View">
            <button onClick={() => set({ view: "grid" })} aria-pressed={filters.view === "grid"} className={cx("min-h-11 px-3 text-sm", filters.view === "grid" ? "bg-surface-2 text-text" : "text-muted")} data-testid="view-grid">
              Covers
            </button>
            <button onClick={() => set({ view: "list" })} aria-pressed={filters.view === "list"} className={cx("min-h-11 px-3 text-sm", filters.view === "list" ? "bg-surface-2 text-text" : "text-muted")} data-testid="view-list">
              List
            </button>
          </div>
          <Link href={`/flip${qs}`} className="hidden min-h-11 items-center rounded-xl bg-accent px-4 text-sm font-semibold text-accent-ink hover:brightness-110 sm:inline-flex" data-testid="flip-link">
            Flip through ▸
          </Link>
        </div>
        <div className="mt-2">
          <PresetRow filters={filters} active={active} set={set} reset={reset} />
        </div>
        {/* Plays like: the top genres as one-tap toggles; the sheet has the rest. */}
        <div className="scrollbar-none -mx-4 mt-2 flex gap-1.5 overflow-x-auto px-4" data-testid="genre-row">
          {facets.genres.slice(0, 12).map((g) => {
            const on = filters.tags.includes(g.name);
            return (
              <button
                key={g.name}
                onClick={() => set({ tags: on ? filters.tags.filter((t) => t !== g.name) : [...filters.tags, g.name] })}
                aria-pressed={on}
                className={cx("min-h-10 shrink-0 rounded-full border px-3 text-sm transition touch-manipulation", on ? "border-accent-2 bg-accent-2/15 text-accent-2 font-semibold" : "border-border/60 bg-bg-elev text-muted hover:text-text")}
                data-testid="genre-chip"
              >
                {g.name}
              </button>
            );
          })}
        </div>
      </div>

      {/* Tonight's picks */}
      {active === 0 && filters.view === "grid" && picks.length ? (
        <section className="mt-4">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="font-display text-base font-bold">Tonight&apos;s picks</h2>
            <span className="text-xs text-faint">six at random, same on every phone today</span>
          </div>
          <div className="scrollbar-none -mx-4 flex gap-3 overflow-x-auto px-4 pb-2">
            {picks.map((g) => (
              <div key={g.id} className="w-28 shrink-0 sm:w-32">
                <GameCard game={g} priority />
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {/* Results */}
      <section className="mt-5">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-display text-base font-bold" data-testid="result-count">
            {active ? `${result.confirmed.length} ${result.confirmed.length === 1 ? "game" : "games"}` : `All ${games.length} games`}
            {active && result.maybe.length ? <span className="ml-2 text-sm font-normal text-muted">+ {result.maybe.length} that could work</span> : null}
          </h2>
          <div className="flex items-center gap-3 text-xs text-muted">
            <label className="flex items-center gap-1">
              Sort
              <select value={filters.sort} onChange={(e) => set({ sort: e.target.value as Filters["sort"], seed: e.target.value === "shuffle" ? Date.now() % 100000 : null })} className="min-h-10 rounded-lg border border-border bg-surface px-2 text-sm text-text">
                <option value="title">A–Z</option>
                <option value="year">Year</option>
                <option value="rating">Rating</option>
                <option value="shuffle">Shuffle</option>
              </select>
            </label>
            <button onClick={() => set({ view: filters.view === "grid" ? "list" : "grid" })} className="min-h-10 rounded-lg border border-border bg-surface px-3 text-sm text-text sm:hidden">
              {filters.view === "grid" ? "List" : "Covers"}
            </button>
          </div>
        </div>

        {result.confirmed.length === 0 && result.maybe.length === 0 ? (
          <EmptyState filters={filters} set={set} reset={reset} excluded={result.excluded} />
        ) : (
          <>
            {result.confirmed.length === 0 ? (
              <p className="mb-4 rounded-xl border border-border bg-surface px-4 py-3 text-sm text-muted">
                Nothing is <em>confirmed</em> for this, but the games below have no player data yet and might work.
              </p>
            ) : null}
            <Games games={result.confirmed} view={filters.view} />
            {result.maybe.length ? (
              <>
                <div className="my-6 flex items-center gap-3 text-xs text-muted">
                  <span className="h-px flex-1 bg-border" />
                  <span>
                    {result.maybe.length} more could work — no {filters.players || filters.mode ? "player" : filters.length ? "length" : filters.era ? "year" : ""} data yet
                  </span>
                  <span className="h-px flex-1 bg-border" />
                </div>
                <Games games={result.maybe} view={filters.view} dim />
              </>
            ) : null}
          </>
        )}
      </section>

      {/* Phone: flip CTA */}
      <Link
        href={`/flip${qs}`}
        className="fixed bottom-5 right-4 z-20 inline-flex min-h-12 items-center rounded-full bg-accent px-5 text-sm font-semibold text-accent-ink shadow-xl shadow-black/50 sm:hidden"
        data-testid="flip-link-phone"
      >
        Flip through ▸
      </Link>

      <FilterSheet open={sheetOpen} onClose={closeSheet} filters={filters} facets={facets} set={set} reset={reset} active={active} confirmed={result.confirmed.length} maybe={result.maybe.length} />
      <PlatformSidebar open={platformsOpen} onClose={closePlatforms} platforms={facets.platforms} totalGames={games.length} filters={filters} set={set} />
    </div>
  );
}

function Games({ games, view, dim }: { games: ShelfGame[]; view: Filters["view"]; dim?: boolean }) {
  if (view === "list") {
    return (
      <div className="-mx-2 divide-y divide-border/50" data-testid="list">
        {games.map((g) => (
          <GameRow key={g.id} game={g} dim={dim} />
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))] sm:gap-x-4" data-testid="grid">
      {games.map((g, i) => (
        <GameCard key={g.id} game={g} dim={dim} priority={i < 12} />
      ))}
    </div>
  );
}

function EmptyState({ filters, set, reset, excluded }: { filters: Filters; set: (p: Partial<Filters>) => void; reset: () => void; excluded: number }) {
  const loosen: { label: string; patch: Partial<Filters> }[] = [];
  if (filters.strict) loosen.push({ label: "Include games with no data", patch: { strict: false } });
  if (filters.mode) loosen.push({ label: `Any way of playing`, patch: { mode: null } });
  if (filters.players && filters.players > 2) loosen.push({ label: "Any number of players", patch: { players: null } });
  if (filters.tags.length) loosen.push({ label: `Any kind of game`, patch: { tags: [] } });
  if (filters.length) loosen.push({ label: "Any length", patch: { length: null } });
  if (filters.era) loosen.push({ label: "Any era", patch: { era: null } });
  if (filters.play) loosen.push({ label: "Played or not", patch: { play: null } });
  if (filters.platforms.length) loosen.push({ label: "Any platform", patch: { platforms: [] } });
  if (filters.hideHandhelds) loosen.push({ label: "Show handheld games", patch: { hideHandhelds: false } });
  if (filters.q) loosen.push({ label: "Clear search", patch: { q: "" } });
  return (
    <div className="rounded-2xl border border-border bg-surface px-6 py-10 text-center" data-testid="empty">
      <p className="font-display text-lg font-bold">Nothing on the shelf fits all of that.</p>
      <p className="mt-1 text-sm text-muted">{excluded} games were ruled out. Loosen one thing:</p>
      <div className="mt-4 flex flex-wrap justify-center gap-2">
        {loosen.map((l) => (
          <Button key={l.label} onClick={() => set(l.patch)}>
            {l.label}
          </Button>
        ))}
        <Button variant="ghost" onClick={reset}>
          Start over
        </Button>
      </div>
    </div>
  );
}
