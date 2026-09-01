import Link from "next/link";
import { redirect } from "next/navigation";
import { SearchBox } from "@/components/search-box";
import { SiteHeader } from "@/components/site-header";
import { HomeRowSection, PicksRow, PlayingPanel } from "@/components/home/row";
import { loadPlaying, loadShelf } from "@/lib/collection";
import { tonightsPicks } from "@/lib/filters";
import { buildHomeRows } from "@/lib/home";
import { listSeriesWithOwned } from "@/lib/series/service";

export const dynamic = "force-dynamic";

/**
 * Home (GAMEEXPLOR-0012). Carousels of cover art built from what the shelf
 * already knows, tonight's picks, and what you are in the middle of.
 *
 * **One data load.** `loadShelf()` is the same payload the shelf sends;
 * `loadPlaying()` and `listSeriesWithOwned()` are two more constant queries.
 * Every row is then derived *in memory* from those three — never a query per
 * row, and never an IGDB or LLM call on a browse path.
 *
 * Row selection is deterministic per day (see src/lib/home.ts), so opening a
 * game and pressing back shows the same page rather than reshuffling it.
 */

/**
 * The shelf's filter keys. `/` was the shelf until this ticket, so a phone
 * bookmark or a shared link carrying any of them is a shelf URL: forward it,
 * whole, rather than dropping the filter on the floor.
 */
const SHELF_PARAMS = ["q", "platform", "handhelds", "players", "mode", "tags", "genre", "length", "era", "play", "strict", "view", "sort", "seed"];

function legacyShelfQuery(params: Record<string, string | string[] | undefined>): string | null {
  if (!SHELF_PARAMS.some((k) => params[k] != null)) return null;
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    for (const one of Array.isArray(v) ? v : v != null ? [v] : []) out.append(k, one);
  }
  return out.toString().replace(/%2C/g, ",");
}

export default async function HomePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const legacy = legacyShelfQuery(await searchParams);
  if (legacy) redirect(`/shelf?${legacy}`);

  const [games, playing, series] = await Promise.all([loadShelf(), loadPlaying(), listSeriesWithOwned()]);
  const picks = tonightsPicks(games);
  const rows = buildHomeRows(games, { series: series.map((s) => ({ name: s.name, slug: s.slug, ownedIds: s.ownedIds })) });
  const hasPlaying = playing.inProgress.length > 0 || playing.upNext.length > 0;

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-7xl px-4 pb-16">
        <div className="mt-5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
          <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">Tonight</h1>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <Link href="/shelf" prefetch={false} className="text-accent-2 hover:underline" data-testid="all-games-link">
              All {games.length} games <span aria-hidden>›</span>
            </Link>
            <Link href="/flip" prefetch={false} className="text-muted hover:text-text">
              Flip through <span aria-hidden>›</span>
            </Link>
            {series.length ? (
              <Link href="/series" prefetch={false} className="text-muted hover:text-text">
                Series <span aria-hidden>›</span>
              </Link>
            ) : null}
          </div>
        </div>

        {/* The ticket's literal ask (GAMEEXPLOR-0027), and the top of the page
            is where a phone thumb starts. It searches the whole collection by
            going to /shelf?q=… — nothing here indexes anything. Off when the
            shelf is empty, where the import prompt below is the only useful
            thing to offer. */}
        {games.length ? <SearchBox variant="hero" /> : null}

        {games.length === 0 ? (
          <p className="mt-8 rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted" data-testid="home-empty">
            Nothing on the shelf yet.{" "}
            <Link href="/import" className="text-accent-2 underline">
              Import your collection
            </Link>{" "}
            and this page fills itself.
          </p>
        ) : null}

        {picks.length ? <PicksRow games={picks} /> : null}
        {hasPlaying ? <PlayingPanel inProgress={playing.inProgress} upNext={playing.upNext} /> : null}

        {rows.map((row, i) => (
          <HomeRowSection key={row.key} row={row} priority={i === 0} />
        ))}

        {rows.length ? (
          <div className="mt-10 text-center">
            <Link href="/shelf" prefetch={false} className="inline-flex min-h-11 items-center rounded-xl border border-border bg-surface px-5 text-sm text-muted transition hover:border-muted hover:text-text">
              Browse all {games.length} games
            </Link>
          </div>
        ) : null}
      </main>
    </>
  );
}
