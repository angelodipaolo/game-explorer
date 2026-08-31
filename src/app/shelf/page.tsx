import { Suspense } from "react";
import { SiteHeader } from "@/components/site-header";
import { Shelf } from "@/components/shelf/shelf";
import { loadShelf } from "@/lib/collection";
import { readViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";
export const metadata = { title: "Shelf" };

/**
 * Every game, with the filters — what the shelf is good at. It used to be the
 * landing page (GAMEEXPLOR-0012 moved home to `/`), so `/` still forwards any
 * old filter URL here rather than dropping it. Tonight's picks moved to home;
 * the toolbar, presets, genre row and filter sheet stayed.
 */
export default async function ShelfPage() {
  const [games, viewer] = await Promise.all([loadShelf(), readViewer()]);
  return (
    <>
      <SiteHeader />
      <main>
        <Suspense>
          <Shelf games={games} viewer={viewer} />
        </Suspense>
      </main>
    </>
  );
}
