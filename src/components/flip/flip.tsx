"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ShelfGame } from "@/lib/collection";
import type { Viewer } from "@/lib/viewer";
import { applyFilters, activeFilterCount, facets as buildFacets, serializeFilters } from "@/lib/filters";
import { FilterSheet } from "@/components/shelf/filter-sheet";
import { Badge, cx } from "@/components/ui";
import { Cover } from "@/components/shelf/cover";
import { PlayersLine, minutesLabel } from "@/components/shelf/players-line";
import { useFilters } from "@/components/shelf/use-filters";
import { platformLabel } from "@/lib/platforms";

/**
 * One game at a time, readable across a room. The set is the current filter
 * (confirmed first, then the "could work" ones). Arrow keys, swipe, and a
 * shuffle button that lands somewhere new.
 */
export function Flip({ games, viewer }: { games: ShelfGame[]; viewer: Viewer }) {
  // Flip is worth coming back to, so it records where you were; it has no
  // covers/list toggle, so it has no view to restore.
  const [filters, set, reset] = useFilters({ trackLastUrl: true });
  const result = useMemo(() => applyFilters(games, filters), [games, filters]);
  const facets = useMemo(() => buildFacets(games), [games]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const closeSheet = useCallback(() => setSheetOpen(false), []);
  const deck = useMemo(() => [...result.confirmed, ...result.maybe], [result]);
  const confirmedCount = result.confirmed.length;
  const [index, setIndex] = useState(0);
  // Reset position whenever the set changes (React's "adjust state during render" pattern).
  const deckKey = deck.map((g) => g.id).join("|");
  const [seenKey, setSeenKey] = useState(deckKey);
  if (seenKey !== deckKey) {
    setSeenKey(deckKey);
    setIndex(0);
  }
  const [spinning, setSpinning] = useState(false);
  const [dir, setDir] = useState<1 | -1>(1);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const active = activeFilterCount(filters);
  const shelfHref = `/shelf${serializeFilters(filters)}`;

  const go = useCallback(
    (d: 1 | -1) => {
      if (!deck.length) return;
      setDir(d);
      setIndex((i) => (i + d + deck.length) % deck.length);
    },
    [deck.length],
  );

  const surprise = useCallback(() => {
    if (deck.length < 2 || spinning) return;
    setSpinning(true);
    const target = (index + 1 + Math.floor(Math.random() * (deck.length - 1))) % deck.length;
    let hops = 0;
    const total = 10;
    const tick = () => {
      hops++;
      setDir(1);
      setIndex(hops >= total ? target : Math.floor(Math.random() * deck.length));
      if (hops < total) setTimeout(tick, 45 + hops * 22);
      else setSpinning(false);
    };
    tick();
  }, [deck.length, index, spinning]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
      else if (e.key === " " || e.key === "s") {
        e.preventDefault();
        surprise();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, surprise]);

  const game = deck[index];
  const isMaybe = index >= confirmedCount;

  return (
    <div
      className="flex min-h-dvh flex-col bg-bg"
      onTouchStart={(e) => (touch.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
      onTouchEnd={(e) => {
        if (!touch.current) return;
        const dx = e.changedTouches[0].clientX - touch.current.x;
        const dy = e.changedTouches[0].clientY - touch.current.y;
        touch.current = null;
        if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
      }}
      data-testid="flip"
    >
      <header className="flex items-center justify-between px-4 py-3">
        <Link href={shelfHref} className="inline-flex min-h-11 items-center gap-1 rounded-xl px-2 text-sm text-muted hover:text-text" data-testid="flip-back">
          ◂ Shelf
        </Link>
        <div className="text-center text-xs text-muted">
          {deck.length ? (
            <>
              <span className="text-text" data-testid="flip-counter">
                {index + 1} / {deck.length}
              </span>
              {active ? <span className="block">{describe(filters.players, filters.mode, filters.platforms, filters.tags, filters.length, filters.hideHandhelds)}</span> : <span className="block">the whole shelf</span>}
            </>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          <button onClick={() => set({ sort: "shuffle", seed: Date.now() % 100000 })} className="min-h-11 rounded-xl px-2 text-sm text-muted hover:text-text" title="Reshuffle the order" aria-label="Reshuffle">
            ⇄
          </button>
          <button
            onClick={() => setSheetOpen(true)}
            className={cx("min-h-11 rounded-xl px-3 text-sm", active ? "bg-accent font-semibold text-accent-ink" : "border border-border bg-surface text-text")}
            data-testid="flip-open-filters"
            aria-expanded={sheetOpen}
          >
            Filters{active ? ` · ${active}` : ""}
          </button>
        </div>
      </header>
      <FilterSheet open={sheetOpen} onClose={closeSheet} filters={filters} facets={facets} set={set} reset={reset} active={active} confirmed={result.confirmed.length} maybe={result.maybe.length} showPresets viewer={viewer} />

      {!game ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <p className="font-display text-2xl font-bold">Nothing fits all of that.</p>
          <Link href={shelfHref} className="rounded-xl bg-accent px-4 py-3 font-semibold text-accent-ink">
            Loosen the filters
          </Link>
        </div>
      ) : (
        <main className="flex flex-1 flex-col items-center justify-center px-4 pb-4 sm:flex-row sm:gap-10 sm:px-12">
          <div key={game.id} className={cx("w-[min(62vw,44dvh)] shrink-0 sm:w-[min(36vw,60dvh)]", spinning ? "" : dir === 1 ? "animate-fade-up" : "animate-fade-up")}>
            <Link href={`/game/${game.id}`} prefetch={false}>
              <Cover imageId={game.cover} title={game.name} size="huge" priority className="shadow-2xl shadow-black/60 ring-1 ring-white/10" />
            </Link>
          </div>
          <div className="mt-5 w-full max-w-xl text-center sm:mt-0 sm:text-left">
            <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-start">
              {game.copies.map((c) => (
                <Badge key={c.platform}>{c.platformLabel}</Badge>
              ))}
              {game.year ? <span className="text-sm text-muted">{game.year}</span> : null}
              {isMaybe ? <Badge tone="warn">no player data</Badge> : null}
            </div>
            <h1 className="mt-2 font-display text-3xl font-bold leading-tight tracking-tight sm:text-5xl" data-testid="flip-title">
              {game.name}
            </h1>
            <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 text-lg sm:justify-start sm:text-xl">
              <PlayersLine players={game.players} />
              {game.playtime != null ? <span className="text-muted">{minutesLabel(game.playtime)}</span> : null}
            </div>
            <div className="mt-2 flex flex-wrap justify-center gap-1.5 sm:justify-start">
              {[...game.genres, ...game.themes.slice(0, 2)].slice(0, 5).map((t) => (
                <Badge key={t}>{t}</Badge>
              ))}
            </div>
            {game.summary ? <p className="mx-auto mt-4 line-clamp-3 max-w-prose text-sm text-muted sm:mx-0 sm:text-base">{game.summary}</p> : null}
            <div className="mt-5 hidden sm:block">
              <Link href={`/game/${game.id}`} className="inline-flex min-h-11 items-center rounded-xl border border-border bg-surface px-4 text-sm hover:border-muted">
                Details, screenshots, similar ▸
              </Link>
            </div>
          </div>
        </main>
      )}

      {game ? (
        <footer className="sticky bottom-0 border-t border-border/60 bg-bg/90 pb-safe backdrop-blur">
          <div className="mx-auto grid max-w-2xl grid-cols-[1fr_auto_1fr] items-center gap-3 px-4 py-3">
          <button onClick={() => go(-1)} className="min-h-14 rounded-2xl border border-border bg-surface text-2xl active:scale-95" aria-label="Previous" data-testid="flip-prev">
            ◂
          </button>
          <button onClick={surprise} disabled={spinning} className="min-h-14 rounded-2xl bg-accent px-6 font-display text-base font-bold text-accent-ink active:scale-95 disabled:opacity-70" data-testid="flip-surprise">
            🎲 Surprise me
          </button>
          <button onClick={() => go(1)} className="min-h-14 rounded-2xl border border-border bg-surface text-2xl active:scale-95" aria-label="Next" data-testid="flip-next">
            ▸
          </button>
          <Link href={`/game/${game.id}`} className="col-span-3 -mt-1 text-center text-sm text-accent-2 sm:hidden">
            Details, screenshots, similar ▸
          </Link>
          </div>
        </footer>
      ) : null}
    </div>
  );
}

function describe(players: number | null, mode: string | null, platforms: string[], tags: string[], length: string | null, hideHandhelds: boolean): string {
  const bits: string[] = [];
  if (players) bits.push(players === 1 ? "just me" : `${players}${players === 4 ? "+" : ""} players`);
  if (mode) bits.push(mode === "together" ? "at the same time" : mode);
  if (tags.length) bits.push(tags.map((t) => t.toLowerCase()).join(" + "));
  if (length) bits.push(length === "quick" ? "quick" : length === "evening" ? "an evening" : "a saga");
  if (platforms.length) bits.push(platforms.map((p) => platformLabel(p)).join(" or "));
  if (hideHandhelds) bits.push("no handheld-only games");
  return bits.join(" · ");
}
