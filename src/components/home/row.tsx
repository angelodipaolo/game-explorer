import Link from "next/link";
import { GameCard } from "@/components/shelf/game-card";
import { PlayingCard, QueueCaption, RunCaption } from "@/components/playing/playing-card";
import { shelfGridThreeUp } from "@/components/shelf/grid";
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
 * What is in progress and what is up next — cover art, like everything else on
 * this page (GAMEEXPLOR-0026): a game looks the same wherever you meet it, so
 * these are the shelf's own cards with the run context captioned underneath.
 *
 * A grid rather than a carousel, unlike the rows above it. This section is
 * short and capped, and it is acted on rather than browsed — hiding half of it
 * behind a sideways scroll would bury the one game you came back to finish.
 * Covers cost height: a full panel of seven is about twice the old list's, and
 * the cap and the three-across grid are what hold that to one screenful.
 *
 * Rendered only when there is something in it, so a collection with no play
 * log yet simply does not show it.
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
      {/* Three across on a phone rather than the shelf's two. A full panel is
          still taller than the list it replaced — seven cards are three rows,
          roughly twice the height — so the cap matters: three across is what
          keeps the day's rows within a scroll of it rather than a page. */}
      <div className={shelfGridThreeUp} role="list">
        {inProgress.slice(0, 4).map((r) => (
          <PlayingCard key={r.sessionId} row={r} testId="home-in-progress" caption={<RunCaption row={r} compact />} />
        ))}
        {/* `compact`: "Up next", not "#2". This section's only heading is
            "Where you left off", and a bare position under a game nobody has
            started would read as a run. */}
        {upNext.slice(0, 3).map((r) => (
          <PlayingCard key={r.ownedGameId} row={r} testId="home-up-next" caption={<QueueCaption row={r} compact />} />
        ))}
      </div>
    </section>
  );
}
