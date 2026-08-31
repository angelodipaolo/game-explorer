import Link from "next/link";
import { Cover } from "@/components/shelf/cover";
import { GameCard } from "@/components/shelf/game-card";
import { day } from "@/components/ui";
import type { InProgressRow, QueuedRow, ShelfGame } from "@/lib/collection";
import type { HomeRow } from "@/lib/home";
import { Carousel } from "./carousel";

/**
 * A row: a header that *is* the filter it was built from, and the covers.
 *
 * The header link is the point of the page — a row is a shelf view, so
 * "Puzzle games on the NES →" opens `/shelf?tags=Puzzle&platform=nes` and
 * finds the same games. Home is a way into the filter system, not a second one
 * beside it.
 */
export function HomeRowSection({ row, priority }: { row: HomeRow; priority?: boolean }) {
  return (
    <section className="mt-7" data-testid="home-row" data-row-key={row.key} data-row-kind={row.kind}>
      <Link href={row.href} prefetch={false} className="group mb-2 flex min-h-11 items-baseline gap-2" data-testid="row-header">
        <h2 className="font-display text-base font-bold tracking-tight group-hover:text-accent-2 sm:text-lg">{row.title}</h2>
        <span className="text-xs text-faint group-hover:text-accent-2" data-testid="row-total">
          {row.total} <span aria-hidden>›</span>
        </span>
      </Link>
      <Carousel label={row.title}>
        {row.games.map((g, i) => (
          <div key={g.id} className="carousel-item w-28 sm:w-36">
            <GameCard game={g} priority={priority && i < 6} />
          </div>
        ))}
      </Carousel>
    </section>
  );
}

/** Tonight's picks: the same six on every phone in the room, new tomorrow. */
export function PicksRow({ games }: { games: ShelfGame[] }) {
  return (
    <section className="mt-4" data-testid="tonights-picks">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="font-display text-base font-bold tracking-tight sm:text-lg">Tonight&apos;s picks</h2>
        <span className="text-xs text-faint">six at random, same on every phone today</span>
      </div>
      <Carousel label="Tonight's picks">
        {games.map((g) => (
          <div key={g.id} className="carousel-item w-32 sm:w-40">
            <GameCard game={g} priority />
          </div>
        ))}
      </Carousel>
    </section>
  );
}

/**
 * What is in progress and what is up next — a short vertical list, not a
 * carousel: these are the rows you act on rather than browse, and there are
 * never many. Rendered only when there is something in it, so a collection
 * with no play log yet simply does not show it.
 */
export function PlayingPanel({ inProgress, upNext }: { inProgress: InProgressRow[]; upNext: QueuedRow[] }) {
  return (
    <section className="mt-6" data-testid="home-playing">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h2 className="font-display text-base font-bold tracking-tight sm:text-lg">Where you left off</h2>
        <Link href="/playing" prefetch={false} className="text-xs text-accent-2 hover:underline" data-testid="playing-link">
          Now playing <span aria-hidden>›</span>
        </Link>
      </div>
      <ul className="flex flex-col gap-2">
        {inProgress.slice(0, 4).map((r) => (
          <li key={r.sessionId}>
            <Link href={`/game/${r.ownedGameId}`} prefetch={false} className="flex items-center gap-3 rounded-xl border border-accent/40 bg-accent/5 p-2 transition hover:border-accent" data-testid="home-in-progress">
              <Cover imageId={r.cover} title={r.name} size="small" className="w-10 shrink-0 rounded-md" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{r.name}</span>
                <span className="block truncate text-xs text-muted">
                  {r.platformLabel} · since {day(r.startedAt)}
                </span>
              </span>
              <span className="shrink-0 text-xs text-accent" aria-hidden>
                ▶
              </span>
            </Link>
          </li>
        ))}
        {upNext.slice(0, 3).map((r) => (
          <li key={r.ownedGameId}>
            <Link href={`/game/${r.ownedGameId}`} prefetch={false} className="flex items-center gap-3 rounded-xl border border-border bg-surface p-2 transition hover:border-muted" data-testid="home-up-next">
              <Cover imageId={r.cover} title={r.name} size="small" className="w-10 shrink-0 rounded-md" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{r.name}</span>
                <span className="block truncate text-xs text-muted">
                  Up next · {r.platformLabel}
                </span>
              </span>
              <span className="shrink-0 text-xs text-faint tabular-nums" aria-hidden>
                {r.position + 1}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
