import type { ReactNode } from "react";
import { GameCard } from "@/components/shelf/game-card";
import { cx, day } from "@/components/ui";
import type { InProgressRow, QueuedRow } from "@/lib/collection";

/**
 * A run, drawn as the shelf draws a game (GAMEEXPLOR-0026).
 *
 * The rule the owner asked for is that a game looks like a game everywhere, so
 * this is the shelf's own `GameCard` — not a fork of it and not a variant prop
 * on it — with the *run* context as a caption underneath. `InProgressRow` and
 * `QueuedRow` already carry the whole `ShelfGame` for the copy, so the card
 * needs nothing this page has to invent.
 *
 * The caption is where the two pages differ from the shelf and from each
 * other: since-when and where you left off for an open run, position and note
 * for a queued one. Two lines at most, both truncated — a card is a glance,
 * and the game page is one tap away for the rest.
 *
 * `GameCard` already badges an open run with ▶ Playing on the cover, so
 * nothing here draws a second play marker.
 */
export function PlayingCard({
  row,
  caption,
  dim,
  priority,
  testId,
  children,
}: {
  row: InProgressRow | QueuedRow;
  caption?: ReactNode;
  /** "Could work" — no data either way under the current filter. Same meaning, and same `?` badge, as on the shelf. */
  dim?: boolean;
  priority?: boolean;
  testId?: string;
  /** Controls that belong to this card, under the caption (the queue's ▲ ▼ / Play now / ×). */
  children?: ReactNode;
}) {
  return (
    <div className={cx(children ? "flex flex-col" : null)} data-testid={testId}>
      <GameCard game={row.game} dim={dim} priority={priority} />
      {caption ? <div className="mt-1 px-0.5 text-xs leading-snug">{caption}</div> : null}
      {children ? <div className="mt-auto pt-2">{children}</div> : null}
    </div>
  );
}

/**
 * An open run: the copy and when it started, and — on `/playing`, where there
 * is room for it — the last thing written during the run, else the run's note.
 *
 * `compact` is home's three-across card, about 105px wide on a phone, where
 * "PS4 · since 31 Aug 2026" truncates to "PS4 · since 31 A…". There the
 * platform and the date get a line each, and the year is dropped for a run
 * started this year — the ambiguity it removes only exists across a new year,
 * and that is exactly when `shortDay` keeps it.
 */
export function RunCaption({ row, leftOff = false, compact = false }: { row: InProgressRow; leftOff?: boolean; compact?: boolean }) {
  const where = row.lastEntry ? (row.lastEntry.body ?? row.lastEntry.title ?? "") : row.note;
  if (compact) {
    return (
      <>
        <span className="block truncate text-muted">{row.platformLabel}</span>
        <span className="block truncate text-faint">since {shortDay(row.startedAt)}</span>
      </>
    );
  }
  return (
    <>
      <span className="block truncate text-muted">
        {row.platformLabel} · since {day(row.startedAt)}
      </span>
      {leftOff && where ? <span className="block truncate text-faint">{where}</span> : null}
    </>
  );
}

/** `day()` without the year when the year is this one. */
function shortDay(d: Date | string): string {
  const x = new Date(d);
  const full = day(x);
  return x.getFullYear() === new Date().getFullYear() ? full.replace(/ \d{4}$/, "") : full;
}

/** A queued copy: where it sits in the order, the platform, and its note. */
export function QueueCaption({ row }: { row: QueuedRow }) {
  return (
    <>
      <span className="block truncate text-muted">
        <span className="tabular-nums">#{row.position + 1}</span> · {row.platformLabel}
      </span>
      {row.note ? <span className="block truncate text-faint">{row.note}</span> : null}
    </>
  );
}

/**
 * The shelf's grid, phone-first. Two across at 375px is what the shelf does
 * (`src/components/shelf/shelf.tsx`), and on `/playing` it is also what leaves
 * room for the queue's four controls under a card.
 */
export const playingGrid = "grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-[repeat(auto-fill,minmax(150px,1fr))] sm:gap-x-4";
