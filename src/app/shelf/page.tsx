import { Suspense } from "react";
import { SiteHeader } from "@/components/site-header";
import { Shelf } from "@/components/shelf/shelf";
import { ShelfFilterScope } from "@/components/shelf/filter-context";
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
    // The scope wraps the header as well as the shelf: the platform menu lives
    // in the header now, and this is what lets it filter in place instead of
    // navigating (see components/shelf/filter-context.tsx).
    <ShelfFilterScope>
      <SiteHeader />
      <main>
        <Suspense>
          <Shelf games={games} viewer={viewer} />
        </Suspense>
      </main>
    </ShelfFilterScope>
  );
}
