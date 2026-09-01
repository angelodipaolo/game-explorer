import type { ReactNode } from "react";
import { GameCard } from "@/components/shelf/game-card";
import { cx, day, shortDay } from "@/components/ui";
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
 * for a queued one.
 *
 * `role="listitem"` because both of these grids are lists — the queue is
 * genuinely an ordered one — and the `<ul>` these cards replaced said so.
 * Every grid that renders a `PlayingCard` carries `role="list"` to match.
 *
 * `GameCard` already badges an open run with ▶ Playing on the cover and the
 * platform on a chip, so nothing here draws a second play marker, and the
 * compact captions do not repeat the platform.
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
    <div role="listitem" className={cx(children ? "flex flex-col" : null)} data-testid={testId}>
      <GameCard game={row.game} dim={dim} priority={priority} />
      {caption ? <div className="mt-1 px-0.5 text-xs leading-snug">{caption}</div> : null}
      {children ? <div className="mt-auto pt-2">{children}</div> : null}
    </div>
  );
}

/**
 * An open run: when it started, and — on `/playing`, where there is room for
 * it — the last thing written during the run, else the run's note.
 *
 * That last line is the reason "In progress" exists at all — it is the thing
 * you came back to read — so it is clamped rather than truncated. A card is
 * about 160px wide at every width the grid uses, and one line of it holds
 * about a third of a real note; three hold a whole one. The caption is allowed
 * to be taller than its neighbour's, exactly as `GameCard`'s own two-line
 * title already is.
 *
 * `compact` is home's three-across card, about 105px wide on a phone, where
 * "PS4 · since 31 Aug 2026" truncates to "PS4 · since 31 A…". There the
 * platform is left to the cover's chip and the year is dropped for a run
 * started this year — the ambiguity it removes only exists across a new year,
 * and that is exactly when `shortDay` keeps it.
 */
export function RunCaption({ row, leftOff = false, compact = false }: { row: InProgressRow; leftOff?: boolean; compact?: boolean }) {
  const where = row.lastEntry ? (row.lastEntry.body ?? row.lastEntry.title ?? "") : row.note;
  if (compact) return <span className="block truncate text-muted">since {shortDay(row.startedAt)}</span>;
  return (
    <>
      <span className="block truncate text-muted">
        {row.platformLabel} · since {day(row.startedAt)}
      </span>
      {leftOff && where ? (
        <span className="mt-0.5 line-clamp-3 text-faint" data-testid="left-off">
          {where}
        </span>
      ) : null}
    </>
  );
}

/**
 * A queued copy: where it sits in the order, the platform, and its note.
 *
 * `compact` is home again, and there it says "Up next" instead of "#2".
 * "Where you left off" is the only heading on that page and it is about open
 * runs, so a bare position under a card the owner has never started reads as a
 * lie — the old list carried its own "Up next ·" label for exactly that
 * reason. On `/playing` an "Up next" `<h2>` sits directly above these cards
 * and the number is the useful half; the grid order already says the rest,
 * which is why the old layout kept the number in its own right-hand column
 * rather than in the caption.
 */
export function QueueCaption({ row, compact = false }: { row: QueuedRow; compact?: boolean }) {
  if (compact) return <span className="block truncate text-muted">Up next</span>;
  return (
    <>
      <span className="block truncate text-muted">
        <span className="tabular-nums">#{row.position + 1}</span> · {row.platformLabel}
      </span>
      {row.note ? <span className="block truncate text-faint">{row.note}</span> : null}
    </>
  );
}
