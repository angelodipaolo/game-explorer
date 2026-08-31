import { Suspense } from "react";
import { SiteHeader } from "@/components/site-header";
import { Playing } from "@/components/playing/playing";
import { loadPlaying } from "@/lib/collection";
import { readViewer } from "@/lib/viewer";

export const dynamic = "force-dynamic";
export const metadata = { title: "Now playing" };

/**
 * What you are in the middle of, and what is next. Two lists that are disjoint
 * by construction: starting a run removes the copy from the queue in the same
 * transaction, so a game is never in both.
 *
 * Both lists are filterable with the shelf's filters (GAMEEXPLOR-0015), which
 * live in the URL — so the rendering moved into a client component and needs
 * the `<Suspense>` boundary that `useSearchParams` requires, exactly as
 * `/shelf` does.
 *
 * Public: what is on the go is worth showing to anyone with the link. Only the
 * controls that reorder or start a run are the owner's.
 */
export default async function PlayingPage() {
  const [{ inProgress, upNext }, viewer] = await Promise.all([loadPlaying(), readViewer()]);
  return (
    <>
      <SiteHeader />
      <Suspense>
        <Playing inProgress={inProgress} upNext={upNext} viewer={viewer} />
      </Suspense>
    </>
  );
}
