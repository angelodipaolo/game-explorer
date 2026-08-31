"use client";

import Link from "next/link";
import { useMemo } from "react";
import type { InProgressRow, QueuedRow } from "@/lib/collection";
import type { Viewer } from "@/lib/viewer";
import { activeFilterCount, facets as buildFacets, splitInOrder } from "@/lib/filters";
import { Button, cx, day } from "@/components/ui";
import { Cover } from "@/components/shelf/cover";
import { FilterBar } from "@/components/filters/filter-bar";
import { useFilters } from "@/components/shelf/use-filters";
import { QueueList } from "./queue-list";

/**
 * `/playing`, with the shelf's filters over it (GAMEEXPLOR-0015). The page is
 * two ordered lists — open runs, newest first, and the curated queue — and the
 * order is the whole point of both, so filtering here only ever *removes*
 * rows. Nothing is sorted, which is why `sortGames` is nowhere in this file.
 *
 * `useFilters` is used without `scrollTopOnChange`: that is the shelf's
 * behaviour, where a filter change is a screenful of different games. This
 * page is a handful of rows and jumping it would just feel like a glitch.
 */
export function Playing({ inProgress, upNext, viewer }: { inProgress: InProgressRow[]; upNext: QueuedRow[]; viewer: Viewer }) {
  const [filters, set, reset] = useFilters();
  const active = activeFilterCount(filters);
  // Facets over both lists at once, so the sheet offers the platforms and tags
  // that are actually on this page with counts that add up — a "SNES (12)"
  // borrowed from the shelf would be a lie here.
  const facets = useMemo(() => buildFacets([...inProgress, ...upNext].map((r) => r.game)), [inProgress, upNext]);
  // `splitInOrder`, never `applyFilters`: the latter re-sorts, and run recency
  // and the queue's curated `position` are the content of these two lists.
  const open = useMemo(() => shown(splitInOrder(inProgress, filters)), [inProgress, filters]);
  const queue = useMemo(() => shown(splitInOrder(upNext, filters)), [upNext, filters]);

  return (
    <main className="mx-auto max-w-3xl px-4 pb-16">
      <h1 className="mt-5 font-display text-2xl font-bold tracking-tight sm:text-3xl">Now playing</h1>

      <div className="mt-4">
        <FilterBar filters={filters} set={set} reset={reset} facets={facets} viewer={viewer} confirmed={open.confirmed.length + queue.confirmed.length} maybe={open.maybe.length + queue.maybe.length} placeholder="Search these games" />
      </div>

      <section className="mt-6">
        <SectionHeading label="In progress" shown={open.shown} total={inProgress.length} active={active} />
        {open.shown ? (
          <ul className="flex flex-col gap-2" data-testid="in-progress">
            {open.kept.map((r) => (
              <li key={r.sessionId} className={cx(open.dim.has(r.ownedGameId) && "opacity-60")}>
                <Link href={`/game/${r.ownedGameId}`} className="flex items-center gap-3 rounded-xl border border-accent/40 bg-accent/5 p-2 transition hover:border-accent" prefetch={false} data-testid="playing-row">
                  <Cover imageId={r.cover} title={r.name} size="small" className="w-12 shrink-0 rounded-md" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{r.name}</span>
                    <span className="block truncate text-xs text-muted">
                      {r.platformLabel} · since {day(r.startedAt)}
                    </span>
                    {/* Where you left off: the last thing written during this run, else the run's own note. */}
                    {r.lastEntry || r.note ? <span className="mt-0.5 block truncate text-xs text-faint">{r.lastEntry ? (r.lastEntry.body ?? r.lastEntry.title ?? "") : r.note}</span> : null}
                  </span>
                  <span className="shrink-0 text-xs text-accent" aria-hidden>
                    ▶
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        ) : inProgress.length ? (
          // Hidden by the filter, not absent. Saying "nothing on the go" here
          // would be a lie about the shelf rather than a fact about the filter.
          <FilteredEmpty what="run" hidden={inProgress.length} reset={reset} testId="in-progress-filtered-empty" />
        ) : (
          <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted" data-testid="in-progress-empty">
            Nothing on the go.{" "}
            <Link href="/shelf?play=never" className="text-accent-2 underline">
              Find something you have never played
            </Link>
            .
          </p>
        )}
        {open.maybe.length ? <MaybeNote n={open.maybe.length} /> : null}
      </section>

      <section className="mt-8">
        <SectionHeading label="Up next" shown={queue.shown} total={upNext.length} active={active} />
        {queue.shown ? (
          <>
            {/* `locked`: the reorder endpoint takes the whole queue as one
                permutation, and a filtered list is not one. See QueueList. */}
            <QueueList rows={queue.kept} canEdit={viewer.canEdit} locked={active > 0} dim={queue.dim} onClearFilters={reset} />
            {queue.maybe.length ? <MaybeNote n={queue.maybe.length} /> : null}
          </>
        ) : upNext.length ? (
          <FilteredEmpty what="queued game" hidden={upNext.length} reset={reset} testId="queue-filtered-empty" />
        ) : (
          <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted" data-testid="queue-empty">
            The queue is empty. Open a game and tap <span className="text-text">Add to queue</span> —{" "}
            <Link href="/shelf" className="text-accent-2 underline">
              back to the shelf
            </Link>
            .
          </p>
        )}
      </section>
    </main>
  );
}

/** "In progress · 2 of 5" under a filter; "In progress · 5" without one. */
/**
 * How many rows a section will draw, and which of them are the "could work"
 * ones — by id, not by position. Dimming has to be a property of the row and
 * not a boundary index, because these lists render `kept`, in their own order,
 * with the maybes left where they belong rather than swept to the end.
 */
function shown<T extends { ownedGameId: string }>(s: { confirmed: T[]; maybe: T[]; kept: T[]; excluded: number }) {
  return { ...s, shown: s.kept.length, dim: new Set(s.maybe.map((r) => r.ownedGameId)) };
}

function SectionHeading({ label, shown, total, active }: { label: string; shown: number; total: number; active: number }) {
  return (
    <h2 className="mb-3 font-display text-base font-bold">
      {label} {total ? <span className="text-muted">· {active ? `${shown} of ${total}` : total}</span> : null}
    </h2>
  );
}

/**
 * The dimmed rows have no data either way — they are not confirmed and were
 * not ruled out. The shelf marks the boundary with a divider, which it can do
 * because it groups them; these lists keep their own order and dim in place,
 * so the note names them rather than pointing at a boundary.
 */
function MaybeNote({ n }: { n: number }) {
  return (
    <p className="mt-2 text-xs text-muted">
      {n === 1 ? "One dimmed game has" : `${n} dimmed games have`} no data either way.
    </p>
  );
}

function FilteredEmpty({ what, hidden, reset, testId }: { what: string; hidden: number; reset: () => void; testId: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted" data-testid={testId}>
      <p>
        {hidden === 1 ? `The one ${what} here does not` : `None of the ${hidden} ${what}s here`} match the filters.
      </p>
      <Button variant="ghost" className="mt-3" onClick={reset}>
        Clear filters
      </Button>
    </div>
  );
}
