import { Suspense } from "react";
import { SiteHeader } from "@/components/site-header";
import { Shelf } from "@/components/shelf/shelf";
import { loadShelf } from "@/lib/collection";

export const dynamic = "force-dynamic";

export default async function ShelfPage() {
  const games = await loadShelf();
  return (
    <>
      <SiteHeader />
      <main>
        <Suspense>
          <Shelf games={games} />
        </Suspense>
      </main>
    </>
  );
}
