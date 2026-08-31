import { SiteHeader } from "@/components/site-header";
import { SeriesBuilder } from "@/components/series/series-builder";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";
export const metadata = { title: "New series" };

/**
 * Seed, prune, save.
 *
 * The entry point is a game you own, not an IGDB collection id: nobody knows
 * that 453 is Mario Party. Picking a game asks IGDB which collections it is in
 * (a game is usually in several — see the probe note, which is exactly why
 * something has to choose), and the chosen one becomes a candidate list to
 * prune. A collection id can still be typed straight in.
 *
 * The owned list is handed over once, server-side, so the picker filters
 * instantly instead of round-tripping per keystroke.
 */
export default async function NewSeriesPage() {
  const rows = await prisma.ownedGame.findMany({
    where: { catalogGameId: { not: null } },
    select: { catalogGameId: true, title: true, catalogGame: { select: { name: true, firstReleaseDate: true } } },
    orderBy: { title: "asc" },
  });
  // One row per IGDB game: the same title on NES and SNES is one thing to
  // start a series from.
  const seen = new Set<number>();
  const games: { igdbId: number; name: string; year: number | null }[] = [];
  for (const r of rows) {
    if (r.catalogGameId == null || seen.has(r.catalogGameId)) continue;
    seen.add(r.catalogGameId);
    games.push({ igdbId: r.catalogGameId, name: r.catalogGame?.name ?? r.title, year: r.catalogGame?.firstReleaseDate?.getUTCFullYear() ?? null });
  }

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 pb-24">
        <h1 className="mt-5 font-display text-2xl font-bold tracking-tight sm:text-3xl">New series</h1>
        <p className="mt-1 max-w-prose text-sm text-muted">IGDB proposes the members; you prune them. What you keep is what the page shows — the collection is only ever a seed.</p>
        <SeriesBuilder games={games} />
      </main>
    </>
  );
}
